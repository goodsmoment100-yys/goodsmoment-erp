// ============================================
// APP - Core application logic
// ============================================

// ---- Permission Helper ----
function isManager(user) {
  // 현재 모든 멤버가 임원이므로 전체 해제
  // 나중에 팀원 들어오면 아래 주석 해제하고 이 줄 삭제
  return true;
  // if (!user || !user.profile) return false;
  // const role = user.profile.role;
  // const dept = user.profile.department;
  // return role === 'ceo' || role === 'admin' || role === 'manager' || dept === '경영';
}

// ---- Toast Notifications ----
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '\u2713' : type === 'error' ? '\u2717' : '\u24D8'}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ---- Clock ----
function updateClock() {
  const timeEl = document.getElementById('current-time');
  const dateEl = document.getElementById('current-date');
  if (!timeEl) return;

  const now = new Date();
  timeEl.textContent = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  }
}

// ---- Attendance (매장 맞춤: 출근→휴게시작→휴게종료→퇴근) ----
async function clockIn() {
  const user = await getCurrentUser();
  if (!user) return;
  const today = new Date().toISOString().split('T')[0];

  const { data: existing } = await sb.from('attendance').select('*').eq('user_id', user.id).eq('date', today).single();
  if (existing && existing.clock_in) { showToast('이미 출근 처리되었습니다.', 'error'); return; }

  const { error } = await sb.from('attendance').upsert({ user_id: user.id, date: today, clock_in: new Date().toISOString(), status: 'working' });
  if (error) { showToast('출근 실패: ' + error.message, 'error'); return; }
  showToast('출근 완료!', 'success');
  updateAttendanceUI();
}

async function breakStart() {
  const user = await getCurrentUser();
  if (!user) return;
  const today = new Date().toISOString().split('T')[0];

  const { data } = await sb.from('attendance').select('*').eq('user_id', user.id).eq('date', today).single();
  if (!data || !data.clock_in) { showToast('먼저 출근하세요.', 'error'); return; }
  if (data.break_start && !data.break_end) { showToast('이미 휴게 중입니다.', 'error'); return; }

  const { error } = await sb.from('attendance').update({ break_start: new Date().toISOString(), status: 'break' }).eq('id', data.id);
  if (error) { showToast('휴게 시작 실패: ' + error.message, 'error'); return; }
  showToast('휴게시간 시작!', 'info');
  updateAttendanceUI();
}

async function breakEnd() {
  const user = await getCurrentUser();
  if (!user) return;
  const today = new Date().toISOString().split('T')[0];

  const { data } = await sb.from('attendance').select('*').eq('user_id', user.id).eq('date', today).single();
  if (!data || !data.break_start) { showToast('휴게 시작을 먼저 하세요.', 'error'); return; }

  const breakMins = Math.round((new Date() - new Date(data.break_start)) / 60000);
  const { error } = await sb.from('attendance').update({ break_end: new Date().toISOString(), break_minutes: breakMins, status: 'working' }).eq('id', data.id);
  if (error) { showToast('휴게 종료 실패: ' + error.message, 'error'); return; }
  showToast('휴게 종료! (' + breakMins + '분)', 'success');
  updateAttendanceUI();
}

async function clockOut() {
  const user = await getCurrentUser();
  if (!user) return;
  const today = new Date().toISOString().split('T')[0];

  const { data: existing } = await sb.from('attendance').select('*').eq('user_id', user.id).eq('date', today).single();
  if (!existing || !existing.clock_in) { showToast('먼저 출근하세요.', 'error'); return; }
  if (existing.clock_out) { showToast('이미 퇴근했습니다.', 'error'); return; }

  const now = new Date();
  const totalMins = (now - new Date(existing.clock_in)) / 60000;
  const breakMins = existing.break_minutes || 0;
  const workMins = totalMins - breakMins;
  const workHours = (workMins / 60).toFixed(1);

  const { error } = await sb.from('attendance').update({
    clock_out: now.toISOString(),
    work_hours: parseFloat(workHours),
    status: 'done'
  }).eq('id', existing.id);

  if (error) { showToast('퇴근 실패: ' + error.message, 'error'); return; }
  showToast('퇴근 완료! 실근무: ' + workHours + '시간', 'success');
  updateAttendanceUI();
}

async function updateAttendanceUI() {
  const user = await getCurrentUser();
  if (!user) return;
  const today = new Date().toISOString().split('T')[0];

  const { data } = await sb.from('attendance').select('*').eq('user_id', user.id).eq('date', today).single();

  const btnIn = document.getElementById('btn-clock-in');
  const btnOut = document.getElementById('btn-clock-out');
  const btnBreakStart = document.getElementById('btn-break-start');
  const btnBreakEnd = document.getElementById('btn-break-end');
  const statusEl = document.getElementById('attendance-status');
  const detailEl = document.getElementById('today-status-detail');

  if (!btnIn) return;

  // 수요일 휴무 체크
  const dayOfWeek = new Date().getDay();
  const wedNotice = document.getElementById('wednesday-notice');
  if (wedNotice) wedNotice.style.display = (dayOfWeek === 3) ? 'block' : 'none';

  // 버튼 초기화
  btnIn.disabled = true; btnOut.disabled = true;
  if (btnBreakStart) btnBreakStart.disabled = true;
  if (btnBreakEnd) btnBreakEnd.disabled = true;

  const fmt = (iso) => iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '-';

  if (!data || !data.clock_in) {
    // 미출근
    btnIn.disabled = false;
    if (statusEl) statusEl.innerHTML = '<span class="status-badge off">미출근</span>';
    if (detailEl) detailEl.style.display = 'none';
  } else if (data.status === 'break') {
    // 휴게중
    if (btnBreakEnd) btnBreakEnd.disabled = false;
    if (statusEl) statusEl.innerHTML = '<span class="status-badge" style="background:var(--yellow-bg); color:#B8860B;">휴게중</span>';
    showTodayDetail(data);
  } else if (!data.clock_out) {
    // 근무중
    btnOut.disabled = false;
    if (btnBreakStart) btnBreakStart.disabled = !!(data.break_start && data.break_end); // 휴게 이미 했으면 비활성
    if (!data.break_start && btnBreakStart) btnBreakStart.disabled = false;
    if (statusEl) statusEl.innerHTML = '<span class="status-badge working">근무중</span>';
    showTodayDetail(data);
  } else {
    // 퇴근완료
    if (statusEl) statusEl.innerHTML = '<span class="status-badge done">퇴근완료</span>';
    showTodayDetail(data);
  }
}

function showTodayDetail(data) {
  const detailEl = document.getElementById('today-status-detail');
  if (!detailEl) return;
  detailEl.style.display = 'block';

  const fmt = (iso) => iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '-';

  document.getElementById('today-clock-in').textContent = fmt(data.clock_in);
  document.getElementById('today-clock-out').textContent = fmt(data.clock_out);
  document.getElementById('today-break').textContent = data.break_minutes ? data.break_minutes + '분' : '-';
  document.getElementById('today-work-hours').textContent = data.work_hours ? data.work_hours + '시간' : '근무중...';
}

// ---- Attendance History ----
async function loadAttendanceHistory() {
  const user = await getCurrentUser();
  if (!user) return;

  const { data } = await sb
    .from('attendance')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: false })
    .limit(30);

  const tbody = document.getElementById('attendance-history');
  if (!tbody || !data) return;

  const canSeeTime = isManager(user);

  tbody.innerHTML = data.map(record => {
    const statusClass = record.status === 'working' ? 'working' : record.status === 'done' ? 'done' : 'off';
    const statusText = record.status === 'working' ? '근무중' : record.status === 'done' ? '퇴근' : '-';

    if (canSeeTime) {
      const clockIn = record.clock_in ? new Date(record.clock_in).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '-';
      const clockOut = record.clock_out ? new Date(record.clock_out).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '-';
      return `<tr>
        <td>${record.date}</td>
        <td>${clockIn}</td>
        <td>${clockOut}</td>
        <td>${record.work_hours ? record.work_hours + '시간' : '-'}</td>
        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
      </tr>`;
    } else {
      return `<tr>
        <td>${record.date}</td>
        <td>${record.clock_in ? 'O' : '-'}</td>
        <td>${record.clock_out ? 'O' : '-'}</td>
        <td>-</td>
        <td><span class="status-badge ${statusClass}">${statusText}</span></td>
      </tr>`;
    }
  }).join('');
}

// ---- Notices ----
async function loadNotices() {
  const { data } = await sb
    .from('notices')
    .select('*, profiles(name)')
    .order('created_at', { ascending: false })
    .limit(20);

  const list = document.getElementById('notice-list');
  if (!list || !data) return;

  if (data.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>등록된 공지사항이 없습니다.</p></div>';
    return;
  }

  list.innerHTML = data.map(notice => {
    const tagClass = notice.tag === 'important' ? 'important' : notice.tag === 'event' ? 'event' : 'general';
    const tagText = notice.tag === 'important' ? '중요' : notice.tag === 'event' ? '행사' : '일반';
    const date = new Date(notice.created_at).toLocaleDateString('ko-KR');
    const author = notice.profiles ? notice.profiles.name : '관리자';

    return `<div class="notice-item" onclick="viewNotice('${notice.id}')">
      <div>
        <span class="notice-tag ${tagClass}">${tagText}</span>
        <span class="notice-title">${notice.title}</span>
      </div>
      <div class="notice-meta">${author} · ${date}</div>
    </div>`;
  }).join('');
}

async function createNotice(title, content, tag) {
  const user = await getCurrentUser();
  if (!user) return;

  const { error } = await sb.from('notices').insert({
    title,
    content,
    tag,
    author_id: user.id
  });

  if (error) {
    showToast('공지 등록 실패: ' + error.message, 'error');
    return;
  }

  showToast('공지가 등록되었습니다.', 'success');
  closeModal('notice-modal');
  loadNotices();
}

async function viewNotice(id) {
  const { data } = await sb
    .from('notices')
    .select('*, profiles(name)')
    .eq('id', id)
    .single();

  if (!data) return;

  const modal = document.getElementById('notice-view-modal');
  if (!modal) return;

  document.getElementById('view-notice-title').textContent = data.title;
  document.getElementById('view-notice-content').textContent = data.content;
  document.getElementById('view-notice-meta').textContent =
    `${data.profiles?.name || '관리자'} · ${new Date(data.created_at).toLocaleDateString('ko-KR')}`;

  openModal('notice-view-modal');
}

// ---- Approvals ----
async function loadApprovals(filter = 'all') {
  const user = await getCurrentUser();
  if (!user) return;

  let query = sb
    .from('approvals')
    .select('*, profiles!approvals_requester_id_fkey(name)')
    .order('created_at', { ascending: false });

  if (filter === 'my') {
    query = query.eq('requester_id', user.id);
  } else if (filter === 'pending') {
    query = query.eq('status', 'pending').eq('approver_id', user.id);
  }

  const { data } = await query.limit(30);

  const list = document.getElementById('approval-list');
  if (!list) return;

  if (!data || data.length === 0) {
    list.innerHTML = '<div class="empty-state"><p>결재 내역이 없습니다.</p></div>';
    return;
  }

  list.innerHTML = data.map(item => {
    const typeMap = { leave: '휴가', expense: '지출', report: '업무보고', other: '기타' };
    const date = new Date(item.created_at).toLocaleDateString('ko-KR');
    const requesterName = item.profiles ? item.profiles.name : '알 수 없음';

    return `<div class="approval-item">
      <div class="approval-info">
        <div class="approval-type">${typeMap[item.type] || item.type}</div>
        <div class="approval-title">${item.title}</div>
        <div class="approval-meta">${requesterName} · ${date}</div>
      </div>
      <div>
        <span class="badge badge-${item.status}">${item.status === 'pending' ? '대기중' : item.status === 'approved' ? '승인' : '반려'}</span>
      </div>
    </div>`;
  }).join('');
}

async function createApproval(type, title, content) {
  const user = await getCurrentUser();
  if (!user) return;

  // Get first admin/ceo as approver
  const { data: admins } = await sb
    .from('profiles')
    .select('id')
    .in('role', ['admin', 'ceo'])
    .limit(1);

  const approverId = admins && admins.length > 0 ? admins[0].id : user.id;

  const { error } = await sb.from('approvals').insert({
    requester_id: user.id,
    approver_id: approverId,
    type,
    title,
    content,
    status: 'pending'
  });

  if (error) {
    showToast('결재 요청 실패: ' + error.message, 'error');
    return;
  }

  showToast('결재가 요청되었습니다.', 'success');
  closeModal('approval-modal');
  loadApprovals();
}

async function handleApproval(id, status) {
  const { error } = await sb
    .from('approvals')
    .update({ status, decided_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    showToast('처리 실패: ' + error.message, 'error');
    return;
  }

  showToast(status === 'approved' ? '승인되었습니다.' : '반려되었습니다.', 'success');
  loadApprovals();
}

// ---- Settlements ----
async function loadSettlements() {
  const user = await getCurrentUser();
  if (!user) return;

  const { data } = await sb
    .from('settlements')
    .select('*, profiles(name)')
    .order('created_at', { ascending: false })
    .limit(30);

  const tbody = document.getElementById('settlement-list');
  if (!tbody) return;

  if (!data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">정산 내역이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map(item => {
    const date = new Date(item.created_at).toLocaleDateString('ko-KR');
    const amount = parseInt(item.amount).toLocaleString();

    return `<tr>
      <td>${date}</td>
      <td>${item.project || '-'}</td>
      <td>${item.description}</td>
      <td class="amount negative">${amount}원</td>
      <td>${item.profiles?.name || '-'}</td>
      <td><span class="badge badge-${item.status}">${item.status === 'pending' ? '대기' : item.status === 'approved' ? '승인' : '반려'}</span></td>
    </tr>`;
  }).join('');
}

async function createSettlement(project, description, amount) {
  const user = await getCurrentUser();
  if (!user) return;

  const { error } = await sb.from('settlements').insert({
    user_id: user.id,
    project,
    description,
    amount: parseInt(amount),
    status: 'pending'
  });

  if (error) {
    showToast('정산 등록 실패: ' + error.message, 'error');
    return;
  }

  showToast('정산이 등록되었습니다.', 'success');
  closeModal('settlement-modal');
  loadSettlements();
}

// ---- Dashboard Stats ----
async function loadDashboardStats() {
  const user = await getCurrentUser();
  if (!user) return;

  // Today's attendance count
  const today = new Date().toISOString().split('T')[0];
  const { count: attendanceCount } = await sb
    .from('attendance')
    .select('*', { count: 'exact', head: true })
    .eq('date', today)
    .not('clock_in', 'is', null);

  // Pending approvals count
  const { count: pendingCount } = await sb
    .from('approvals')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  // This month settlements total
  const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const { data: settlements } = await sb
    .from('settlements')
    .select('amount')
    .gte('created_at', firstDay);

  const totalExpense = settlements ? settlements.reduce((sum, s) => sum + (s.amount || 0), 0) : 0;

  // Recent notices count
  const { count: noticeCount } = await sb
    .from('notices')
    .select('*', { count: 'exact', head: true });

  // Update UI
  const el = (id) => document.getElementById(id);
  if (el('stat-attendance')) el('stat-attendance').textContent = attendanceCount || 0;
  if (el('stat-pending')) el('stat-pending').textContent = pendingCount || 0;
  if (el('stat-expense')) el('stat-expense').textContent = totalExpense.toLocaleString() + '원';
  if (el('stat-notices')) el('stat-notices').textContent = noticeCount || 0;
}

// ---- Modal Helpers ----
function openModal(id) {
  document.getElementById(id)?.classList.add('active');
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('active');
}

// ---- Sidebar Navigation ----
function navigateTo(page) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.page-section').forEach(el => el.style.display = 'none');

  const navItem = document.querySelector(`[data-page="${page}"]`);
  const section = document.getElementById(`section-${page}`);

  if (navItem) navItem.classList.add('active');
  if (section) section.style.display = 'block';

  // Load data for each section
  switch(page) {
    case 'dashboard': loadDashboardStats(); break;
    case 'attendance': updateAttendanceUI(); loadAttendanceHistory(); break;
    case 'approval': loadApprovals(); break;
    case 'settlement': loadSettlements(); break;
    case 'notice': loadNotices(); break;
    case 'resources': break;
    case 'admin': loadMembers(); break;
  }
}

// ---- Init Sidebar User ----
async function initSidebar() {
  const user = await getCurrentUser();
  if (!user || !user.profile) return;

  const nameEl = document.getElementById('user-display-name');
  const roleEl = document.getElementById('user-display-role');
  const avatarEl = document.getElementById('user-avatar');

  if (nameEl) nameEl.textContent = user.profile.name;
  if (roleEl) {
    const roleMap = { ceo: '대표', admin: '관리자', manager: '팀장', member: '팀원' };
    roleEl.textContent = `${user.profile.department || ''} · ${roleMap[user.profile.role] || user.profile.role}`;
  }
  if (avatarEl) avatarEl.textContent = getInitials(user.profile.name);

  // Show/hide admin menu
  checkAdminVisibility();
}

// ---- Admin: Members ----
async function loadMembers() {
  const user = await getCurrentUser();
  if (!user) return;

  // Check permission
  if (!isManager(user)) {
    const tbody = document.getElementById('members-list');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="empty-state">관리자 권한이 필요합니다.</td></tr>';
    return;
  }

  // Get all profiles
  const { data: members } = await sb
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true });

  // Get today's attendance
  const today = new Date().toISOString().split('T')[0];
  const { data: todayAttendance } = await sb
    .from('attendance')
    .select('user_id, status, clock_in')
    .eq('date', today);

  const attendanceMap = {};
  if (todayAttendance) {
    todayAttendance.forEach(a => { attendanceMap[a.user_id] = a; });
  }

  const tbody = document.getElementById('members-list');
  if (!tbody || !members) return;

  // Update stats
  const el = (id) => document.getElementById(id);
  if (el('stat-total-members')) el('stat-total-members').textContent = members.length;
  if (el('stat-today-working')) el('stat-today-working').textContent = todayAttendance ? todayAttendance.filter(a => a.status === 'working').length : 0;

  const roleMap = { ceo: '대표', admin: '관리자', manager: '팀장', member: '팀원' };

  tbody.innerHTML = members.map(m => {
    const att = attendanceMap[m.id];
    const attStatus = att ? (att.status === 'working' ? '<span class="status-badge working">근무중</span>' : '<span class="status-badge done">퇴근</span>') : '<span class="status-badge off">미출근</span>';
    const isMe = m.id === user.id;

    return `<tr>
      <td><strong>${m.name}</strong>${isMe ? ' <span style="font-size:11px; color:var(--red);">(나)</span>' : ''}</td>
      <td>${m.department || '-'}</td>
      <td style="font-size:13px; color:var(--gray-500);">${m.email}</td>
      <td>
        <select onchange="changeRole('${m.id}', this.value)" style="padding:4px 8px; border:1px solid var(--gray-200); border-radius:4px; font-size:12px;" ${isMe ? 'disabled' : ''}>
          <option value="member" ${m.role === 'member' ? 'selected' : ''}>팀원</option>
          <option value="manager" ${m.role === 'manager' ? 'selected' : ''}>팀장</option>
          <option value="admin" ${m.role === 'admin' ? 'selected' : ''}>관리자</option>
          <option value="ceo" ${m.role === 'ceo' ? 'selected' : ''}>대표</option>
        </select>
      </td>
      <td>${attStatus}</td>
      <td>
        <select onchange="changeDepartment('${m.id}', this.value)" style="padding:4px 8px; border:1px solid var(--gray-200); border-radius:4px; font-size:12px;">
          <option value="" ${!m.department ? 'selected' : ''}>미지정</option>
          <option value="경영" ${m.department === '경영' ? 'selected' : ''}>경영</option>
          <option value="매장" ${m.department === '매장' ? 'selected' : ''}>매장</option>
          <option value="사무실" ${m.department === '사무실' ? 'selected' : ''}>사무실</option>
          <option value="기타" ${m.department === '기타' ? 'selected' : ''}>기타</option>
        </select>
      </td>
    </tr>`;
  }).join('');
}

async function changeRole(userId, newRole) {
  const { error } = await sb
    .from('profiles')
    .update({ role: newRole })
    .eq('id', userId);

  if (error) {
    showToast('권한 변경 실패: ' + error.message, 'error');
    return;
  }
  showToast('권한이 변경되었습니다.', 'success');
}

async function changeDepartment(userId, newDept) {
  const { error } = await sb
    .from('profiles')
    .update({ department: newDept })
    .eq('id', userId);

  if (error) {
    showToast('부서 변경 실패: ' + error.message, 'error');
    return;
  }
  showToast('부서가 변경되었습니다.', 'success');
}

// ---- Resources: Templates ----
function downloadTemplate(type) {
  const templates = {
    proposal: '../templates/proposal-general.html',
  };
  if (templates[type]) {
    window.open(templates[type], '_blank');
  } else {
    showToast('이 양식은 준비 중입니다.', 'info');
  }
}

function copyColor() {
  const colors = 'Primary: #FF3B30\nBlack: #0A0A0A\nLight: #F2F2F2';
  navigator.clipboard.writeText(colors).then(() => {
    showToast('브랜드 컬러코드가 복사되었습니다!', 'success');
  });
}

// ---- Admin visibility ----
async function checkAdminVisibility() {
  const user = await getCurrentUser();
  if (!user) return;
  const adminSection = document.getElementById('nav-admin-section');
  if (adminSection && !isManager(user)) {
    adminSection.style.display = 'none';
  }
}

// ---- Tab switching ----
function switchTab(tabGroup, tabName) {
  document.querySelectorAll(`[data-tab-group="${tabGroup}"] .tab-item`).forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tabName);
  });
  document.querySelectorAll(`[data-tab-content-group="${tabGroup}"] .tab-content`).forEach(el => {
    el.classList.toggle('active', el.dataset.tabContent === tabName);
  });
}

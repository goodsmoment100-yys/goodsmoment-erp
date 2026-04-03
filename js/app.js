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
const APPROVAL_TYPES = {
  'leave': { label: '연차 신청', color: '#2563EB' },
  'vacation': { label: '휴가 신청', color: '#9333EA' },
  'expense': { label: '지출 결의', color: '#16A34A' },
  'purchase': { label: '구매 요청', color: '#EA580C' },
  'report': { label: '업무 보고', color: '#6B7280' },
  'other': { label: '기타', color: '#6B7280' }
};

function onApprovalTypeChange() {
  const type = document.getElementById('approval-type').value;
  const dateFields = document.getElementById('approval-date-fields');
  const amountField = document.getElementById('approval-amount-field');
  if (dateFields) dateFields.style.display = (type === 'leave' || type === 'vacation') ? 'block' : 'none';
  if (amountField) amountField.style.display = (type === 'expense' || type === 'purchase') ? 'block' : 'none';
}

async function loadApprovalApprovers() {
  const select = document.getElementById('approval-approver');
  if (!select) return;
  const { data } = await sb.from('profiles').select('id, name, role').order('name');
  if (!data) return;
  // 결재자: 육연식(기본), 유희정만 표시
  const approvers = data.filter(p => p.role === 'ceo' || p.name === '육연식' || p.name === '유희정');
  if (approvers.length === 0) {
    // 프로필에 없으면 전체 표시
    select.innerHTML = data.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  } else {
    select.innerHTML = approvers.map(p => `<option value="${p.id}" ${p.name === '육연식' ? 'selected' : ''}>${p.name} (대표)</option>`).join('');
  }
}

async function loadApprovals(filter = 'all') {
  const user = await getCurrentUser();
  if (!user) return;

  // Load approvers for the modal
  loadApprovalApprovers();

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
    const typeInfo = APPROVAL_TYPES[item.type] || { label: item.type, color: '#6B7280' };
    const date = new Date(item.created_at).toLocaleDateString('ko-KR');
    const requesterName = item.profiles ? item.profiles.name : '알 수 없음';
    const statusLabel = item.status === 'pending' ? '대기중' : item.status === 'approved' ? '승인' : '반려';
    const statusColor = item.status === 'pending' ? '#B8860B' : item.status === 'approved' ? '#16A34A' : '#DC2626';
    const statusBg = item.status === 'pending' ? 'var(--yellow-bg, #FEF3C7)' : item.status === 'approved' ? '#DCFCE7' : '#FEE2E2';

    let extraInfo = '';
    if ((item.type === 'expense' || item.type === 'purchase') && item.amount) {
      extraInfo += `<span style="font-size:12px; color:var(--gray-500); margin-left:8px;">${Number(item.amount).toLocaleString()}원</span>`;
    }
    if ((item.type === 'leave' || item.type === 'vacation') && item.start_date) {
      extraInfo += `<span style="font-size:12px; color:var(--gray-500); margin-left:8px;">${item.start_date} ~ ${item.end_date || ''}</span>`;
    }

    return `<div class="approval-item" style="cursor:pointer; padding:12px 16px; border-bottom:1px solid var(--gray-100, #f3f4f6); display:flex; align-items:center; justify-content:space-between;" onclick="openApprovalDetail('${item.id}')">
      <div class="approval-info" style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
        <span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; color:white; background:${typeInfo.color}; white-space:nowrap;">${typeInfo.label}</span>
        <div style="min-width:0; flex:1;">
          <div class="approval-title" style="font-weight:600; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.title}${extraInfo}</div>
          <div class="approval-meta" style="font-size:12px; color:var(--gray-500, #6b7280);">${requesterName} · ${date}</div>
        </div>
      </div>
      <div>
        <span style="display:inline-block; padding:2px 10px; border-radius:4px; font-size:12px; font-weight:600; color:${statusColor}; background:${statusBg};">${statusLabel}</span>
      </div>
    </div>`;
  }).join('');
}

async function createApproval(type, title, content, extras = {}) {
  const user = await getCurrentUser();
  if (!user) return;

  let approverId = extras.approver_id;

  if (!approverId) {
    // Get first admin/ceo as approver
    const { data: admins } = await sb
      .from('profiles')
      .select('id')
      .in('role', ['admin', 'ceo'])
      .limit(1);

    approverId = admins && admins.length > 0 ? admins[0].id : user.id;
  }

  const insertData = {
    requester_id: user.id,
    approver_id: approverId,
    type,
    title,
    content,
    status: 'pending'
  };

  // Add optional fields if supported by the DB
  if (extras.start_date) insertData.start_date = extras.start_date;
  if (extras.end_date) insertData.end_date = extras.end_date;
  if (extras.amount) insertData.amount = extras.amount;
  if (extras.attachment_memo) insertData.attachment_memo = extras.attachment_memo;

  const { error } = await sb.from('approvals').insert(insertData);

  if (error) {
    showToast('결재 요청 실패: ' + error.message, 'error');
    return;
  }

  showToast('결재가 요청되었습니다.', 'success');
  closeModal('approval-modal');
  // Reset form fields
  document.getElementById('approval-title').value = '';
  document.getElementById('approval-content').value = '';
  document.getElementById('approval-type').value = 'leave';
  if (document.getElementById('approval-start-date')) document.getElementById('approval-start-date').value = '';
  if (document.getElementById('approval-end-date')) document.getElementById('approval-end-date').value = '';
  if (document.getElementById('approval-amount')) document.getElementById('approval-amount').value = '';
  if (document.getElementById('approval-attachment-memo')) document.getElementById('approval-attachment-memo').value = '';
  onApprovalTypeChange();
  loadApprovals();
}

async function handleApproval(id, status, rejectReason) {
  const updateData = { status, decided_at: new Date().toISOString() };
  if (status === 'rejected' && rejectReason) {
    updateData.reject_reason = rejectReason;
  }

  const { error } = await sb
    .from('approvals')
    .update(updateData)
    .eq('id', id);

  if (error) {
    showToast('처리 실패: ' + error.message, 'error');
    return;
  }

  showToast(status === 'approved' ? '승인되었습니다.' : '반려되었습니다.', 'success');
  closeModal('approval-detail-modal');
  loadApprovals();
}

async function openApprovalDetail(id) {
  const { data: item } = await sb
    .from('approvals')
    .select('*, profiles!approvals_requester_id_fkey(name)')
    .eq('id', id)
    .single();

  if (!item) { showToast('결재를 찾을 수 없습니다.', 'error'); return; }

  const user = await getCurrentUser();
  const typeInfo = APPROVAL_TYPES[item.type] || { label: item.type, color: '#6B7280' };
  const date = new Date(item.created_at).toLocaleDateString('ko-KR');
  const requesterName = item.profiles ? item.profiles.name : '알 수 없음';
  const statusLabel = item.status === 'pending' ? '대기중' : item.status === 'approved' ? '승인' : '반려';
  const statusColor = item.status === 'pending' ? '#B8860B' : item.status === 'approved' ? '#16A34A' : '#DC2626';
  const statusBg = item.status === 'pending' ? 'var(--yellow-bg, #FEF3C7)' : item.status === 'approved' ? '#DCFCE7' : '#FEE2E2';

  let detailHtml = `
    <div style="margin-bottom:16px; display:flex; align-items:center; gap:10px;">
      <span style="display:inline-block; padding:3px 10px; border-radius:4px; font-size:12px; font-weight:600; color:white; background:${typeInfo.color};">${typeInfo.label}</span>
      <span style="display:inline-block; padding:3px 10px; border-radius:4px; font-size:12px; font-weight:600; color:${statusColor}; background:${statusBg};">${statusLabel}</span>
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:11px; color:var(--gray-500); margin-bottom:2px;">제목</div>
      <div style="font-weight:600; font-size:16px;">${item.title}</div>
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:11px; color:var(--gray-500); margin-bottom:2px;">요청자</div>
      <div>${requesterName}</div>
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:11px; color:var(--gray-500); margin-bottom:2px;">요청일</div>
      <div>${date}</div>
    </div>`;

  if ((item.type === 'leave' || item.type === 'vacation') && item.start_date) {
    detailHtml += `
    <div style="margin-bottom:12px;">
      <div style="font-size:11px; color:var(--gray-500); margin-bottom:2px;">기간</div>
      <div>${item.start_date} ~ ${item.end_date || ''}</div>
    </div>`;
  }

  if ((item.type === 'expense' || item.type === 'purchase') && item.amount) {
    detailHtml += `
    <div style="margin-bottom:12px;">
      <div style="font-size:11px; color:var(--gray-500); margin-bottom:2px;">금액</div>
      <div style="font-weight:600;">${Number(item.amount).toLocaleString()}원</div>
    </div>`;
  }

  if (item.content) {
    detailHtml += `
    <div style="margin-bottom:12px;">
      <div style="font-size:11px; color:var(--gray-500); margin-bottom:2px;">상세 내용</div>
      <div style="white-space:pre-wrap; background:var(--gray-50, #f9fafb); padding:10px; border-radius:6px; font-size:13px;">${item.content}</div>
    </div>`;
  }

  if (item.attachment_memo) {
    detailHtml += `
    <div style="margin-bottom:12px;">
      <div style="font-size:11px; color:var(--gray-500); margin-bottom:2px;">첨부 메모</div>
      <div style="white-space:pre-wrap; background:var(--gray-50, #f9fafb); padding:10px; border-radius:6px; font-size:13px;">${item.attachment_memo}</div>
    </div>`;
  }

  if (item.status === 'rejected' && item.reject_reason) {
    detailHtml += `
    <div style="margin-bottom:12px;">
      <div style="font-size:11px; color:#DC2626; margin-bottom:2px;">반려 사유</div>
      <div style="white-space:pre-wrap; background:#FEE2E2; padding:10px; border-radius:6px; font-size:13px; color:#991B1B;">${item.reject_reason}</div>
    </div>`;
  }

  document.getElementById('approval-detail-content').innerHTML = detailHtml;

  // Show approve/reject buttons only for the approver and if pending
  let actionsHtml = '<button class="btn btn-secondary btn-sm" onclick="closeModal(\'approval-detail-modal\')">닫기</button>';
  if (item.status === 'pending' && user && item.approver_id === user.id) {
    actionsHtml += `
      <div id="approval-reject-reason-wrap" style="display:none; flex:1; margin:0 8px;">
        <textarea id="approval-reject-reason" placeholder="반려 사유를 입력하세요" rows="2" style="width:100%; resize:vertical;"></textarea>
      </div>
      <button class="btn btn-primary btn-sm" onclick="handleApproval('${item.id}', 'approved')">승인</button>
      <button class="btn btn-sm" style="background:#DC2626; color:white; border:none;" onclick="showRejectReason('${item.id}')">반려</button>`;
  }
  document.getElementById('approval-detail-actions').innerHTML = actionsHtml;

  openModal('approval-detail-modal');
}

function showRejectReason(approvalId) {
  const wrap = document.getElementById('approval-reject-reason-wrap');
  if (wrap) {
    if (wrap.style.display === 'none') {
      wrap.style.display = 'block';
      // Replace the reject button to confirm
      const rejectBtn = wrap.parentElement.querySelector('[style*="DC2626"]');
      if (rejectBtn) {
        rejectBtn.textContent = '반려 확인';
        rejectBtn.onclick = function() {
          const reason = document.getElementById('approval-reject-reason').value.trim();
          if (!reason) { showToast('반려 사유를 입력해주세요.', 'error'); return; }
          handleApproval(approvalId, 'rejected', reason);
        };
      }
    }
  }
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
    case 'dashboard': if (typeof loadDashboard === 'function') loadDashboard(); else loadDashboardStats(); break;
    case 'attendance': updateAttendanceUI(); loadAttendanceHistory(); break;
    case 'approval': loadApprovals(); break;
    case 'settlement': loadSettlements(); break;
    case 'notice': loadNotices(); break;
    case 'resources': loadResources(); break;
    case 'schedule': loadSchedule(); break;
    case 'admin': navigateTo('hr'); return; // 조직관리 → 인사/조직관리로 통합
    case 'hr': loadHRList(); loadMembers(); break;
    case 'project': loadProjects(); break;
    case 'accounts': loadAccounts(); loadContacts(); loadParttimeContacts(); break;
    case 'calendar': loadCalendar(); break;
    case 'messages': loadMessages(); break;
    case 'inventory': loadInventory(); break;
    case 'clients': loadClients(); break;
    case 'report': loadReport(); break;
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

// ============================================
// HR Management (인사관리)
// ============================================

// Get HR extra data from localStorage
function getHRStore() {
  try {
    return JSON.parse(localStorage.getItem('gm_hr_data') || '{}');
  } catch (e) {
    return {};
  }
}

function setHRStore(data) {
  localStorage.setItem('gm_hr_data', JSON.stringify(data));
}

// Calculate monthly pay
function calculateMonthlyPay(workHours, payType, payAmount) {
  if (!payAmount) return 0;
  if (payType === '시급') {
    return Math.round(workHours * payAmount);
  }
  return payAmount; // 월급은 그대로
}

// Load HR list - merge profiles with localStorage HR data
async function loadHRList() {
  const user = await getCurrentUser();
  if (!user) return;

  if (!isManager(user)) {
    const tbody = document.getElementById('hr-employee-list');
    if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="empty-state">관리자 권한이 필요합니다.</td></tr>';
    return;
  }

  // Get all profiles from Supabase
  const { data: members } = await sb
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true });

  if (!members) return;

  const hrStore = getHRStore();

  // Get this month's attendance for pay calculation
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  const { data: monthAttendance } = await sb
    .from('attendance')
    .select('user_id, work_hours')
    .gte('date', firstDay)
    .lte('date', lastDay)
    .eq('status', 'done');

  // Build work hours map
  const workHoursMap = {};
  if (monthAttendance) {
    monthAttendance.forEach(a => {
      if (!workHoursMap[a.user_id]) workHoursMap[a.user_id] = 0;
      workHoursMap[a.user_id] += (a.work_hours || 0);
    });
  }

  const roleMap = { ceo: '대표', admin: '관리자', manager: '팀장', member: '팀원' };

  // Calculate stats
  let totalPay = 0, salaryPay = 0, hourlyPay = 0, totalHours = 0, hourlyCount = 0;

  const tbody = document.getElementById('hr-employee-list');
  if (!tbody) return;

  tbody.innerHTML = members.map(m => {
    const hr = hrStore[m.id] || {};
    const contractType = hr.contractType || '정규직';
    const payType = hr.payType || '월급';
    const payAmount = hr.payAmount || 0;
    const joinDate = hr.joinDate || '-';
    const phone = hr.phone || '-';
    const status = hr.status || '재직';
    const userHours = workHoursMap[m.id] || 0;

    // Pay calculation
    const monthPay = calculateMonthlyPay(userHours, payType, payAmount);
    totalPay += monthPay;
    if (payType === '월급') {
      salaryPay += monthPay;
    } else {
      hourlyPay += monthPay;
    }
    totalHours += userHours;
    if (userHours > 0) hourlyCount++;

    const payDisplay = payAmount
      ? (payType === '시급' ? payAmount.toLocaleString() + '원/시' : payAmount.toLocaleString() + '원/월')
      : '-';

    const statusClass = status === '재직' ? 'working' : 'off';

    return `<tr>
      <td><strong>${m.name}</strong></td>
      <td>${m.department || '-'}</td>
      <td>${roleMap[m.role] || m.role || '-'}</td>
      <td>${contractType}</td>
      <td>${payDisplay}</td>
      <td>${joinDate}</td>
      <td>${phone}</td>
      <td><span class="status-badge ${statusClass}">${status}</span></td>
      <td><button class="btn btn-ghost btn-sm" onclick="openHRModal('${m.id}')">수정</button></td>
    </tr>`;
  }).join('');

  // Update stats
  const el = (id) => document.getElementById(id);
  if (el('hr-stat-total-pay')) el('hr-stat-total-pay').textContent = totalPay.toLocaleString() + '원';
  if (el('hr-stat-salary-pay')) el('hr-stat-salary-pay').textContent = salaryPay.toLocaleString() + '원';
  if (el('hr-stat-hourly-pay')) el('hr-stat-hourly-pay').textContent = hourlyPay.toLocaleString() + '원';
  if (el('hr-stat-avg-hours')) el('hr-stat-avg-hours').textContent = hourlyCount > 0 ? (totalHours / hourlyCount).toFixed(1) + '시간' : '-';

  // Load leave summary
  loadHRLeave(members, hrStore, workHoursMap);

  // Load payslips
  loadPayslips();
}

// Load leave (연차) summary
function loadHRLeave(members, hrStore, workHoursMap) {
  const tbody = document.getElementById('hr-leave-list');
  if (!tbody) return;

  tbody.innerHTML = members.map(m => {
    const hr = hrStore[m.id] || {};
    const status = hr.status || '재직';
    if (status === '퇴직') return '';

    // Default 15 days annual leave, calculate used from attendance gaps
    const totalLeave = hr.totalLeave || 15;
    const usedLeave = hr.usedLeave || 0;
    const remaining = totalLeave - usedLeave;

    let leaveStatus = '';
    if (remaining <= 0) {
      leaveStatus = '<span class="status-badge off">소진</span>';
    } else if (remaining <= 3) {
      leaveStatus = '<span class="status-badge" style="background:var(--yellow-bg); color:#B8860B;">부족</span>';
    } else {
      leaveStatus = '<span class="status-badge working">정상</span>';
    }

    return `<tr>
      <td><strong>${m.name}</strong></td>
      <td>${totalLeave}일</td>
      <td>${usedLeave}일</td>
      <td>${remaining}일</td>
      <td>${leaveStatus}</td>
    </tr>`;
  }).filter(Boolean).join('');

  if (!tbody.innerHTML) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">연차 정보가 없습니다.</td></tr>';
  }
}

// Open HR modal for new or edit
async function openHRModal(userId) {
  const titleEl = document.getElementById('hr-modal-title');

  // Reset form
  document.getElementById('hr-edit-user-id').value = '';
  document.getElementById('hr-name').value = '';
  document.getElementById('hr-email').value = '';
  document.getElementById('hr-phone').value = '';
  document.getElementById('hr-department').value = '';
  document.getElementById('hr-role').value = 'member';
  document.getElementById('hr-contract-type').value = '정규직';
  document.getElementById('hr-pay-type').value = '월급';
  document.getElementById('hr-pay-amount').value = '';
  document.getElementById('hr-join-date').value = '';
  document.getElementById('hr-status').value = '재직';
  document.getElementById('hr-memo').value = '';

  if (userId) {
    // Edit mode - load existing data
    titleEl.textContent = '직원 정보 수정';
    document.getElementById('hr-edit-user-id').value = userId;

    // Load from Supabase profile
    const { data: profile } = await sb
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (profile) {
      document.getElementById('hr-name').value = profile.name || '';
      document.getElementById('hr-email').value = profile.email || '';
      document.getElementById('hr-department').value = profile.department || '';
      document.getElementById('hr-role').value = profile.role || 'member';
    }

    // Load from localStorage
    const hrStore = getHRStore();
    const hr = hrStore[userId] || {};
    document.getElementById('hr-phone').value = hr.phone || '';
    document.getElementById('hr-contract-type').value = hr.contractType || '정규직';
    document.getElementById('hr-pay-type').value = hr.payType || '월급';
    document.getElementById('hr-pay-amount').value = hr.payAmount || '';
    document.getElementById('hr-join-date').value = hr.joinDate || '';
    document.getElementById('hr-status').value = hr.status || '재직';
    document.getElementById('hr-memo').value = hr.memo || '';
  } else {
    titleEl.textContent = '직원 등록';
  }

  openModal('hr-modal');
}

// ============================================
// Schedule (근무 스케줄)
// ============================================

const MIN_WAGE_2026 = 10320; // 2026년 최저시급
const WEEKLY_LIMIT = 52;
const OVERTIME_THRESHOLD = 40;

let scheduleYear = new Date().getFullYear();
let scheduleMonth = new Date().getMonth(); // 0-indexed

function getScheduleStore() {
  try {
    const existing = JSON.parse(localStorage.getItem('gm_schedule') || 'null');
    if (existing !== null) return existing;
  } catch (e) {}

  // Pre-populate April 2026 schedule data
  const defaults = {};
  const staff = {
    '이슬M': {1:'O',2:'연차',3:'O',4:'3',5:'휴무',6:'O',7:'O',8:'휴무',9:'O',10:'2',11:'1',12:'휴무',13:'O',14:'O',15:'휴무',16:'O',17:'O',18:'O',19:'휴무',20:'1',21:'O',22:'1',23:'연차',24:'O',25:'O',26:'휴무',27:'휴무',28:'O',29:'3',30:'O'},
    '김형희': {1:'3',2:'1',3:'1',4:'1',5:'1',6:'1',7:'1',8:'휴무',9:'휴무',10:'연차',11:'2',12:'2',13:'2',14:'2',15:'휴무',16:'휴무',17:'3',18:'3',19:'3',20:'3',21:'3',22:'휴무',23:'1',24:'1',25:'1',26:'1',27:'1',28:'',29:'휴무',30:'O'},
    '문지민': {1:'휴무',2:'2',3:'2',4:'2',5:'2',6:'2',7:'휴무',8:'휴무',9:'3',10:'3',11:'3',12:'3',13:'3',14:'휴무',15:'휴무',16:'1',17:'1',18:'1',19:'1',20:'1',21:'2',22:'휴무',23:'3',24:'3',25:'3',26:'3',27:'3',28:'',29:'휴무',30:'O'},
    '윤진별': {1:'휴무',2:'3',3:'3',4:'휴무',5:'3',6:'3',7:'3',8:'휴무',9:'1',10:'1',11:'휴무',12:'1',13:'1',14:'1',15:'휴무',16:'2',17:'2',18:'2',19:'2',20:'2',21:'휴무',22:'휴무',23:'2',24:'2',25:'2',26:'2',27:'휴무',28:'1',29:'O',30:'2'},
    '김아현PT': {1:'휴무',2:'1',3:'휴무',4:'휴무',5:'휴무',6:'휴무',7:'2',8:'휴무',9:'2',10:'4h',11:'4h',12:'휴무',13:'3',14:'휴무',15:'휴무',16:'3',17:'휴무',18:'4h',19:'휴무',20:'휴무',21:'휴무',22:'휴무',23:'휴무',24:'4h',25:'4h',26:'2',27:'2',28:'',29:'휴무',30:'휴무'}
  };

  const wednesdays = [8, 15, 22, 29];

  for (const [name, days] of Object.entries(staff)) {
    for (let d = 1; d <= 30; d++) {
      if (wednesdays.includes(d)) continue; // no entries on Wednesdays
      const val = days[d];
      if (!val || val === '휴무' || val === '연차') continue;

      const dateStr = '2026-04-' + String(d).padStart(2, '0');
      if (!defaults[dateStr]) defaults[dateStr] = [];

      let floor, startTime, endTime, breakMin;

      if (val === '4h') {
        // 4h shift - use floor from context or default
        floor = '전체';
        startTime = '14:00';
        endTime = '18:30';
        breakMin = 30;
      } else if (val === 'O') {
        floor = '전체';
        startTime = '11:30';
        endTime = '20:30';
        breakMin = 60;
      } else {
        // numeric floor
        const floorNum = parseInt(val);
        floor = floorNum + '층';
        startTime = '11:30';
        endTime = '20:30';
        breakMin = 60;
      }

      defaults[dateStr].push({
        name: name,
        floor: floor,
        startTime: startTime,
        endTime: endTime,
        breakMin: breakMin,
        memo: ''
      });
    }
  }

  // ---- May 2026 schedule (5월) ----
  const mayStaff = {
    '이슬M': {1:'4',2:'4',3:'휴무',4:'O',5:'휴무',6:'O',7:'휴무',8:'O',9:'4',10:'O',11:'O',12:'O',13:'휴무',14:'휴무',15:'O',16:'O',17:'O',18:'O',19:'O',20:'휴무',21:'휴무',22:'O',23:'휴무',24:'휴무',25:'휴무',26:'O',27:'휴무',28:'휴무',29:'O',30:'2',31:'휴무'},
    '김형희': {1:'1',2:'휴무',3:'4',4:'4',5:'4',6:'4',7:'4',8:'휴무',9:'휴무',10:'4',11:'4',12:'4',13:'4',14:'4',15:'휴무',16:'3',17:'4',18:'휴무',19:'1',20:'휴무',21:'휴무',22:'휴무',23:'휴무',24:'휴무',25:'휴무',26:'3',27:'휴무',28:'1',29:'휴무',30:'3',31:'3'},
    '문지민': {1:'3',2:'3',3:'휴무',4:'휴무',5:'1',6:'1',7:'휴무',8:'휴무',9:'1',10:'1',11:'휴무',12:'휴무',13:'휴무',14:'1',15:'1',16:'1',17:'1',18:'휴무',19:'휴무',20:'휴무',21:'휴무',22:'1',23:'1',24:'1',25:'1',26:'1',27:'휴무',28:'휴무',29:'1',30:'1',31:'1'},
    '윤진별': {1:'휴무',2:'1',3:'1',4:'1',5:'휴무',6:'3',7:'1',8:'3',9:'3',10:'휴무',11:'휴무',12:'1',13:'1',14:'휴무',15:'2',16:'휴무',17:'휴무',18:'1',19:'휴무',20:'휴무',21:'1',22:'2',23:'휴무',24:'2',25:'2',26:'휴무',27:'휴무',28:'2',29:'2',30:'휴무',31:'2'},
    '김아현PT': {1:'휴무',2:'4h',3:'4h',4:'2',5:'4h',6:'휴무',7:'2',8:'4',9:'4h',10:'휴무',11:'1',12:'3',13:'4h',14:'4h',15:'4',16:'4',17:'휴무',18:'휴무',19:'휴무',20:'휴무',21:'2',22:'휴무',23:'4h',24:'4h',25:'4h',26:'휴무',27:'휴무',28:'휴무',29:'휴무',30:'4h',31:'4h'},
    '차진아PT': {1:'4',2:'2',3:'2',4:'휴무',5:'2',6:'2',7:'휴무',8:'2',9:'2',10:'2',11:'2',12:'휴무',13:'3',14:'3',15:'3',16:'휴무',17:'3',18:'3',19:'3',20:'휴무',21:'휴무',22:'휴무',23:'2',24:'3',25:'3',26:'2',27:'휴무',28:'3',29:'3',30:'휴무',31:'휴무'}
  };

  const mayWednesdays = [7, 14, 21, 28]; // May 2026 Wednesdays (actually 6,13,20,27 are Wednesdays in May 2026)
  // Actually check: May 1 2026 is Friday. So Wednesdays are 6,13,20,27
  const mayOffDays = [6, 13, 20, 27]; // Wednesdays in May 2026

  for (const [name, days] of Object.entries(mayStaff)) {
    for (let d = 1; d <= 31; d++) {
      if (mayOffDays.includes(d)) continue;
      const val = days[d];
      if (!val || val === '휴무' || val === '연차') continue;

      const dateStr = '2026-05-' + String(d).padStart(2, '0');
      if (!defaults[dateStr]) defaults[dateStr] = [];

      let floor, startTime, endTime, breakMin;
      if (val === '4h') {
        floor = '전체'; startTime = '14:00'; endTime = '18:30'; breakMin = 30;
      } else if (val === 'O') {
        floor = '전체'; startTime = '11:30'; endTime = '20:30'; breakMin = 60;
      } else {
        floor = parseInt(val) + '층'; startTime = '11:30'; endTime = '20:30'; breakMin = 60;
      }

      defaults[dateStr].push({ name, floor, startTime, endTime, breakMin, memo: '' });
    }
  }

  localStorage.setItem('gm_schedule', JSON.stringify(defaults));
  return defaults;
}

function setScheduleStore(data) {
  localStorage.setItem('gm_schedule', JSON.stringify(data));
}

function loadSchedule() {
  renderCalendar(scheduleYear, scheduleMonth);
}

function prevMonth() {
  scheduleMonth--;
  if (scheduleMonth < 0) { scheduleMonth = 11; scheduleYear--; }
  renderCalendar(scheduleYear, scheduleMonth);
}

function nextMonth() {
  scheduleMonth++;
  if (scheduleMonth > 11) { scheduleMonth = 0; scheduleYear++; }
  renderCalendar(scheduleYear, scheduleMonth);
}

function renderCalendar(year, month) {
  const label = document.getElementById('schedule-month-label');
  if (label) label.textContent = `${year}년 ${String(month + 1).padStart(2, '0')}월`;

  const tbody = document.getElementById('schedule-calendar-body');
  if (!tbody) return;

  const store = getScheduleStore();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const badgeColors = ['#0d9488', '#6366f1', '#ec4899', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444', '#84cc16'];

  let html = '';
  let dayCount = 1;
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    if (i % 7 === 0) html += '<tr>';

    if (i < firstDay || dayCount > daysInMonth) {
      html += '<td style="padding:8px; vertical-align:top; min-height:80px; height:90px; background:var(--gray-50);"></td>';
    } else {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayCount).padStart(2, '0')}`;
      const isToday = dateStr === todayStr;
      const dayOfWeek = new Date(year, month, dayCount).getDay();
      const isWednesday = dayOfWeek === 3;
      const isSunday = dayOfWeek === 0;

      let cellStyle = 'padding:8px; vertical-align:top; min-height:80px; height:90px; cursor:pointer; transition:background 0.15s;';
      if (isToday) cellStyle += ' border:2px solid var(--primary); background:rgba(13,148,136,0.04);';
      if (isWednesday) cellStyle += ' background:rgba(239,68,68,0.04);';

      const entries = store[dateStr] || [];
      let badgesHtml = '';

      if (isWednesday) {
        badgesHtml += '<span style="display:inline-block; padding:1px 6px; border-radius:4px; font-size:10px; font-weight:700; background:#fecaca; color:#dc2626; margin-top:4px;">휴무</span><br>';
      }

      entries.forEach((entry, idx) => {
        const color = badgeColors[idx % badgeColors.length];
        badgesHtml += `<span style="display:inline-block; padding:1px 6px; border-radius:4px; font-size:10px; font-weight:600; background:${color}20; color:${color}; margin-top:2px; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${entry.name} ${entry.startTime}~${entry.endTime} ${entry.floor}">${entry.name}</span><br>`;
      });

      const dateColor = isSunday ? 'var(--red)' : (dayOfWeek === 6 ? 'var(--blue)' : 'var(--gray-700)');

      html += `<td style="${cellStyle}" onclick="openScheduleModal('${dateStr}')">
        <div style="font-size:13px; font-weight:700; color:${dateColor}; margin-bottom:2px;">${dayCount}</div>
        <div style="line-height:1.4;">${badgesHtml}</div>
      </td>`;
      dayCount++;
    }

    if (i % 7 === 6) html += '</tr>';
  }

  tbody.innerHTML = html;
  calculateScheduleHours();
}

async function openScheduleModal(dateStr) {
  // Populate user dropdown from profiles
  const userSelect = document.getElementById('schedule-user');
  if (userSelect && userSelect.options.length <= 1) {
    try {
      const { data: members } = await sb.from('profiles').select('id, name, department').order('name');
      if (members) {
        userSelect.innerHTML = '<option value="">선택하세요</option>' +
          members.map(m => `<option value="${m.id}" data-name="${m.name}">${m.name} (${m.department || '미지정'})</option>`).join('');
      }
    } catch (e) {
      // If Supabase fails, keep existing options
    }
  }

  if (dateStr) {
    document.getElementById('schedule-date').value = dateStr;
  } else {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('schedule-date').value = today;
  }

  document.getElementById('schedule-start').value = '12:00';
  document.getElementById('schedule-end').value = '20:00';
  document.getElementById('schedule-floor').value = '전체';
  document.getElementById('schedule-break').value = '60';
  document.getElementById('schedule-memo').value = '';
  if (userSelect) userSelect.value = '';

  // Attach event listeners for modal hours tracking (remove old ones first)
  const modalInputs = ['schedule-user', 'schedule-date', 'schedule-start', 'schedule-end', 'schedule-break'];
  modalInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.removeEventListener('change', updateScheduleModalHours);
      el.addEventListener('change', updateScheduleModalHours);
    }
  });
  // Also listen on input for time fields
  ['schedule-start', 'schedule-end'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.removeEventListener('input', updateScheduleModalHours);
      el.addEventListener('input', updateScheduleModalHours);
    }
  });

  // Reset modal hours info
  const infoEl = document.getElementById('schedule-modal-hours-info');
  if (infoEl) infoEl.style.display = 'none';

  openModal('schedule-modal');
}

function saveScheduleEntry() {
  const dateStr = document.getElementById('schedule-date').value;
  const userSelect = document.getElementById('schedule-user');
  const userId = userSelect.value;
  const selectedOption = userSelect.options[userSelect.selectedIndex];
  const userName = selectedOption ? selectedOption.getAttribute('data-name') : '';
  const startTime = document.getElementById('schedule-start').value;
  const endTime = document.getElementById('schedule-end').value;
  const floor = document.getElementById('schedule-floor').value;
  const breakMin = parseInt(document.getElementById('schedule-break').value);
  const memo = document.getElementById('schedule-memo').value.trim();

  if (!dateStr) { showToast('날짜를 선택해주세요.', 'error'); return; }
  if (!userId) { showToast('직원을 선택해주세요.', 'error'); return; }
  if (!startTime || !endTime) { showToast('근무시간을 입력해주세요.', 'error'); return; }

  const store = getScheduleStore();
  if (!store[dateStr]) store[dateStr] = [];

  store[dateStr].push({
    userId: userId,
    name: userName,
    startTime: startTime,
    endTime: endTime,
    floor: floor,
    breakMin: breakMin,
    memo: memo
  });

  setScheduleStore(store);
  closeModal('schedule-modal');
  showToast('스케줄이 등록되었습니다.', 'success');
  renderCalendar(scheduleYear, scheduleMonth);
}

function calculateScheduleHours() {
  const tbody = document.getElementById('schedule-hours-table');
  if (!tbody) return;

  const store = getScheduleStore();
  const hrStore = getHRStore();
  const now = new Date();
  const year = scheduleYear;
  const month = scheduleMonth;

  // Get all entries for the current displayed month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const workerData = {}; // { name: { weekHours, monthHours, dailyDetails: [{date, hours}] } }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const entries = store[dateStr] || [];
    entries.forEach(entry => {
      if (!workerData[entry.name]) {
        workerData[entry.name] = { weekHours: 0, monthHours: 0, dailyDetails: [], userId: entry.userId || null };
      }
      const [sh, sm] = entry.startTime.split(':').map(Number);
      const [eh, em] = entry.endTime.split(':').map(Number);
      const totalMin = (eh * 60 + em) - (sh * 60 + sm) - (entry.breakMin || 0);
      const hours = Math.max(0, totalMin / 60);
      workerData[entry.name].monthHours += hours;
      workerData[entry.name].dailyDetails.push({ date: dateStr, hours: hours });
    });
  }

  // Calculate current week hours (Mon-Sun containing today or the displayed month's context)
  const today = new Date();
  // Find the Monday of the current week
  const dayOfWeek = today.getDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const mondayStr = monday.toISOString().split('T')[0];
  const sundayStr = sunday.toISOString().split('T')[0];

  // Recalculate weekly hours for each worker
  for (const name in workerData) {
    let weekHours = 0;
    workerData[name].dailyDetails.forEach(d => {
      if (d.date >= mondayStr && d.date <= sundayStr) {
        weekHours += d.hours;
      }
    });
    workerData[name].weekHours = weekHours;
  }

  // Get hourly rates from HR data
  function getHourlyRate(workerName, userId) {
    // Try to find by userId first, then by name match
    for (const id in hrStore) {
      const hr = hrStore[id];
      if (hr.payType === '시급' && hr.payAmount) {
        if (id === userId) return hr.payAmount;
        if (hr.name && hr.name === workerName) return hr.payAmount;
      }
    }
    return MIN_WAGE_2026;
  }

  const names = Object.keys(workerData).sort();
  if (names.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">이번 달 스케줄 데이터가 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = names.map(name => {
    const data = workerData[name];
    const weekHours = data.weekHours;
    const monthHours = data.monthHours;
    const hourlyRate = getHourlyRate(name, data.userId);

    // Calculate estimated monthly pay with overtime
    // We need to calculate week by week for the whole month
    let totalPay = 0;
    let totalWeeklyHolidayPay = 0;

    // Group days by ISO week
    const weekMap = {};
    data.dailyDetails.forEach(d => {
      const dt = new Date(d.date);
      // Get ISO week start (Monday)
      const dow = dt.getDay();
      const monOff = dow === 0 ? -6 : 1 - dow;
      const wkMon = new Date(dt);
      wkMon.setDate(dt.getDate() + monOff);
      const wkKey = wkMon.toISOString().split('T')[0];
      if (!weekMap[wkKey]) weekMap[wkKey] = 0;
      weekMap[wkKey] += d.hours;
    });

    for (const wkKey in weekMap) {
      const wkHrs = weekMap[wkKey];
      const regular = Math.min(wkHrs, OVERTIME_THRESHOLD);
      const overtime = Math.max(0, Math.min(wkHrs, WEEKLY_LIMIT) - OVERTIME_THRESHOLD);
      const overLimit = Math.max(0, wkHrs - WEEKLY_LIMIT);
      totalPay += regular * hourlyRate;
      totalPay += overtime * hourlyRate * 1.5;
      totalPay += overLimit * hourlyRate * 1.5; // over 52 still gets overtime rate
      // Weekly holiday pay: if >= 15 hours, add proportional
      if (wkHrs >= 15) {
        totalWeeklyHolidayPay += (wkHrs / 40) * 8 * hourlyRate;
      }
    }
    totalPay += totalWeeklyHolidayPay;

    // Status badge
    let statusHtml = '';
    if (weekHours > WEEKLY_LIMIT) {
      statusHtml = '<span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:700; background:#fecaca; color:#dc2626;">&#9888;&#65039; 52시간 초과</span>';
    } else if (weekHours > OVERTIME_THRESHOLD) {
      statusHtml = '<span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:700; background:#fef3c7; color:#b45309;">연장근무 발생</span>';
    } else {
      statusHtml = '<span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:700; background:#d1fae5; color:#047857;">정상</span>';
    }

    // Week hours color
    let weekColor = '#047857'; // green
    if (weekHours > WEEKLY_LIMIT) weekColor = '#dc2626'; // red
    else if (weekHours > OVERTIME_THRESHOLD) weekColor = '#b45309'; // yellow/amber

    return `<tr>
      <td><strong>${name}</strong></td>
      <td style="font-weight:700; color:${weekColor};">${weekHours.toFixed(1)}시간</td>
      <td>${monthHours.toFixed(1)}시간</td>
      <td>${hourlyRate.toLocaleString()}원</td>
      <td style="font-weight:700;">${Math.round(totalPay).toLocaleString()}원</td>
      <td>${statusHtml}</td>
    </tr>`;
  }).join('');
}

function updateScheduleModalHours() {
  const infoEl = document.getElementById('schedule-modal-hours-info');
  if (!infoEl) return;

  const userSelect = document.getElementById('schedule-user');
  const dateInput = document.getElementById('schedule-date');
  const startInput = document.getElementById('schedule-start');
  const endInput = document.getElementById('schedule-end');
  const breakSelect = document.getElementById('schedule-break');

  if (!userSelect || !userSelect.value || !dateInput.value) {
    infoEl.style.display = 'none';
    return;
  }

  const selectedOption = userSelect.options[userSelect.selectedIndex];
  const workerName = selectedOption ? selectedOption.getAttribute('data-name') : '';
  if (!workerName) { infoEl.style.display = 'none'; return; }

  const store = getScheduleStore();
  const selectedDate = new Date(dateInput.value);
  const dow = selectedDate.getDay();
  const monOff = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(selectedDate);
  monday.setDate(selectedDate.getDate() + monOff);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const mondayStr = monday.toISOString().split('T')[0];
  const sundayStr = sunday.toISOString().split('T')[0];

  // Sum existing weekly hours for this worker
  let existingWeekHours = 0;
  for (const dateStr in store) {
    if (dateStr >= mondayStr && dateStr <= sundayStr) {
      (store[dateStr] || []).forEach(entry => {
        if (entry.name === workerName) {
          const [sh, sm] = entry.startTime.split(':').map(Number);
          const [eh, em] = entry.endTime.split(':').map(Number);
          const mins = (eh * 60 + em) - (sh * 60 + sm) - (entry.breakMin || 0);
          existingWeekHours += Math.max(0, mins / 60);
        }
      });
    }
  }

  // Calculate new entry hours
  let newEntryHours = 0;
  if (startInput.value && endInput.value) {
    const [sh, sm] = startInput.value.split(':').map(Number);
    const [eh, em] = endInput.value.split(':').map(Number);
    const breakMin = parseInt(breakSelect.value) || 0;
    newEntryHours = Math.max(0, ((eh * 60 + em) - (sh * 60 + sm) - breakMin) / 60);
  }

  const totalWeek = existingWeekHours + newEntryHours;

  infoEl.style.display = 'block';
  if (totalWeek > WEEKLY_LIMIT) {
    infoEl.style.background = '#fecaca';
    infoEl.style.color = '#dc2626';
    infoEl.innerHTML = `&#9888;&#65039; <strong>${workerName}</strong>의 이번 주 누적: <strong>${totalWeek.toFixed(1)}시간</strong> (52시간 초과! 근로기준법 위반)`;
  } else if (totalWeek > OVERTIME_THRESHOLD) {
    infoEl.style.background = '#fef3c7';
    infoEl.style.color = '#b45309';
    infoEl.innerHTML = `<strong>${workerName}</strong>의 이번 주 누적: <strong>${totalWeek.toFixed(1)}시간</strong> (연장근무 ${(totalWeek - OVERTIME_THRESHOLD).toFixed(1)}시간 발생)`;
  } else {
    infoEl.style.background = '#d1fae5';
    infoEl.style.color = '#047857';
    infoEl.innerHTML = `<strong>${workerName}</strong>의 이번 주 누적: <strong>${totalWeek.toFixed(1)}시간</strong>`;
  }
}

function deleteScheduleEntry(dateStr, index) {
  if (!confirm('이 스케줄을 삭제하시겠습니까?')) return;
  const store = getScheduleStore();
  if (store[dateStr]) {
    store[dateStr].splice(index, 1);
    if (store[dateStr].length === 0) delete store[dateStr];
    setScheduleStore(store);
    showToast('스케줄이 삭제되었습니다.', 'success');
    renderCalendar(scheduleYear, scheduleMonth);
  }
}

// ============================================
// Resources (자료실)
// ============================================

let currentResourceFilter = '전체';

function getResourceStore() {
  try {
    const data = JSON.parse(localStorage.getItem('gm_resources') || 'null');
    if (data) return data;
  } catch (e) {}

  // Default entries
  const defaults = [
    { title: '회의록 양식', category: '양식', url: '', memo: '', date: '2026-04-01' },
    { title: '연차사용현황', category: '양식', url: '', memo: '', date: '2026-04-01' },
    { title: '입고확인증', category: '양식', url: '', memo: '', date: '2026-04-01' },
    { title: '출고확인증', category: '양식', url: '', memo: '', date: '2026-04-01' },
    { title: '발주서', category: '양식', url: '', memo: '', date: '2026-04-01' },
    { title: '2026 일정&업무 요약', category: '경영자료', url: '', memo: '', date: '2026-04-01' }
  ];
  localStorage.setItem('gm_resources', JSON.stringify(defaults));
  return defaults;
}

function setResourceStore(data) {
  localStorage.setItem('gm_resources', JSON.stringify(data));
}

function loadResources() {
  renderResources();
}

function filterResources(category, btnEl) {
  currentResourceFilter = category;
  document.querySelectorAll('.resource-tab').forEach(el => {
    el.style.background = 'transparent';
    el.style.color = 'var(--gray-600)';
  });
  if (btnEl) {
    btnEl.style.background = 'var(--primary)';
    btnEl.style.color = 'white';
  }
  renderResources();
}

function renderResources() {
  const store = getResourceStore();
  const tbody = document.getElementById('resource-list');
  const countEl = document.getElementById('resource-count');
  if (!tbody) return;

  const filtered = currentResourceFilter === '전체' ? store : store.filter(r => r.category === currentResourceFilter);

  if (countEl) countEl.textContent = filtered.length + '건';

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">등록된 자료가 없습니다.</td></tr>';
    return;
  }

  const categoryColors = {
    '양식': 'var(--blue)',
    '회의록': 'var(--green)',
    '경영자료': 'var(--yellow)',
    '기타': 'var(--gray-500)'
  };

  tbody.innerHTML = filtered.map((r, idx) => {
    const realIdx = store.indexOf(r);
    const color = categoryColors[r.category] || 'var(--gray-500)';
    const linkHtml = r.url
      ? `<a href="${r.url}" target="_blank" style="color:var(--primary); text-decoration:none; font-size:13px;">열기</a>`
      : '<span style="font-size:12px; color:var(--gray-400);">미등록</span>';

    return `<tr>
      <td><strong>${r.title}</strong>${r.memo ? '<br><span style="font-size:11px; color:var(--gray-400);">' + r.memo + '</span>' : ''}</td>
      <td><span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; background:${color}15; color:${color};">${r.category}</span></td>
      <td style="font-size:13px; color:var(--gray-500);">${r.date || '-'}</td>
      <td>${linkHtml}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="deleteResource(${realIdx})" style="color:var(--red); font-size:12px;">삭제</button></td>
    </tr>`;
  }).join('');
}

function saveResource() {
  const title = document.getElementById('resource-title').value.trim();
  const category = document.getElementById('resource-category').value;
  const url = document.getElementById('resource-url').value.trim();
  const memo = document.getElementById('resource-memo').value.trim();

  if (!title) { showToast('제목을 입력해주세요.', 'error'); return; }

  const store = getResourceStore();
  store.push({
    title: title,
    category: category,
    url: url,
    memo: memo,
    date: new Date().toISOString().split('T')[0]
  });
  setResourceStore(store);

  closeModal('resource-modal');
  document.getElementById('resource-title').value = '';
  document.getElementById('resource-url').value = '';
  document.getElementById('resource-memo').value = '';
  showToast('자료가 등록되었습니다.', 'success');
  renderResources();
}

function deleteResource(index) {
  if (!confirm('이 자료를 삭제하시겠습니까?')) return;
  const store = getResourceStore();
  store.splice(index, 1);
  setResourceStore(store);
  showToast('자료가 삭제되었습니다.', 'success');
  renderResources();
}

// Save HR data
async function saveHRData() {
  const userId = document.getElementById('hr-edit-user-id').value;
  const name = document.getElementById('hr-name').value.trim();
  const email = document.getElementById('hr-email').value.trim();
  const phone = document.getElementById('hr-phone').value.trim();
  const department = document.getElementById('hr-department').value;
  const role = document.getElementById('hr-role').value;
  const contractType = document.getElementById('hr-contract-type').value;
  const payType = document.getElementById('hr-pay-type').value;
  const payAmount = parseInt(document.getElementById('hr-pay-amount').value) || 0;
  const joinDate = document.getElementById('hr-join-date').value;
  const status = document.getElementById('hr-status').value;
  const memo = document.getElementById('hr-memo').value.trim();

  if (!name) {
    showToast('이름을 입력해주세요.', 'error');
    return;
  }

  if (userId) {
    // Update existing profile in Supabase
    const { error } = await sb
      .from('profiles')
      .update({ name, department, role })
      .eq('id', userId);

    if (error) {
      showToast('프로필 업데이트 실패: ' + error.message, 'error');
      return;
    }

    // Save extra HR data to localStorage
    const hrStore = getHRStore();
    hrStore[userId] = {
      phone,
      contractType,
      payType,
      payAmount,
      joinDate,
      status,
      memo,
      totalLeave: (hrStore[userId] && hrStore[userId].totalLeave) || 15,
      usedLeave: (hrStore[userId] && hrStore[userId].usedLeave) || 0
    };
    setHRStore(hrStore);

    showToast('직원 정보가 수정되었습니다.', 'success');
  } else {
    // New employee - cannot create Supabase auth user from client
    // Store as pending in localStorage
    const hrStore = getHRStore();
    const tempId = 'temp_' + Date.now();
    hrStore[tempId] = {
      name,
      email,
      phone,
      department,
      role,
      contractType,
      payType,
      payAmount,
      joinDate,
      status,
      memo,
      totalLeave: 15,
      usedLeave: 0,
      isPending: true
    };
    setHRStore(hrStore);

    showToast('직원이 임시 등록되었습니다. (계정 생성은 별도 필요)', 'info');
  }

  closeModal('hr-modal');
  loadHRList();
}

// ============================================
// Project Management (프로젝트 관리)
// ============================================

function getProjectStore() {
  try {
    return JSON.parse(localStorage.getItem('gm_projects') || '[]');
  } catch (e) {
    return [];
  }
}

function setProjectStore(data) {
  localStorage.setItem('gm_projects', JSON.stringify(data));
}

function loadProjects() {
  const projects = getProjectStore();

  // Update stats
  const now = new Date();
  const thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  const activeCount = projects.filter(p => p.status === 'active').length;
  const completedCount = projects.filter(p => p.status === 'completed').length;
  const totalWorkers = projects.filter(p => p.status === 'active').reduce((sum, p) => sum + (p.workers ? p.workers.length : 0), 0);

  // This month revenue: projects whose period overlaps this month
  const monthStart = thisMonth + '-01';
  const monthEnd = thisMonth + '-31';
  const monthRevenue = projects.reduce((sum, p) => {
    if (p.startDate <= monthEnd && p.endDate >= monthStart) {
      return sum + (p.actualRevenue || 0);
    }
    return sum;
  }, 0);

  const el = (id) => document.getElementById(id);
  if (el('proj-stat-active')) el('proj-stat-active').textContent = activeCount;
  if (el('proj-stat-revenue')) el('proj-stat-revenue').textContent = monthRevenue.toLocaleString() + '원';
  if (el('proj-stat-workers')) el('proj-stat-workers').textContent = totalWorkers + '명';
  if (el('proj-stat-completed')) el('proj-stat-completed').textContent = completedCount;

  // Render project cards
  const listEl = document.getElementById('project-list');
  if (!listEl) return;

  if (projects.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><p>등록된 프로젝트가 없습니다.</p></div>';
    return;
  }

  const statusMap = { preparing: '준비중', active: '진행중', completed: '완료' };
  const statusColorMap = { preparing: '#f59e0b', active: '#10b981', completed: '#9ca3af' };
  const statusBgMap = { preparing: 'rgba(245,158,11,0.1)', active: 'rgba(16,185,129,0.1)', completed: 'rgba(156,163,175,0.1)' };

  listEl.innerHTML = projects.map((proj, idx) => {
    const statusText = statusMap[proj.status] || proj.status;
    const statusColor = statusColorMap[proj.status] || '#9ca3af';
    const statusBg = statusBgMap[proj.status] || 'rgba(156,163,175,0.1)';
    const workerCount = proj.workers ? proj.workers.length : 0;
    const laborCost = calculateProjectCost(proj);

    return `<div class="card" style="margin-bottom:16px;">
      <div class="card-body" style="cursor:pointer;" onclick="toggleProjectDetail('${proj.id}')">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:12px;">
          <div style="flex:1; min-width:200px;">
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">
              <h3 style="margin:0; font-size:16px; font-weight:700;">${proj.name}</h3>
              <span style="display:inline-block; padding:2px 10px; border-radius:20px; font-size:11px; font-weight:700; background:${statusBg}; color:${statusColor};">${statusText}</span>
            </div>
            <div style="display:flex; gap:16px; flex-wrap:wrap; font-size:13px; color:var(--gray-500);">
              <span>IP: ${proj.ip || '-'}</span>
              <span>${proj.floor || '-'}</span>
              <span>${proj.startDate || '-'} ~ ${proj.endDate || '-'}</span>
              <span>알바 ${workerCount}명</span>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:11px; color:var(--gray-400); margin-bottom:4px;">예상 / 실제 매출</div>
            <div style="font-size:18px; font-weight:800; color:var(--black);">
              ${(proj.expectedRevenue || 0).toLocaleString()}원
            </div>
            <div style="font-size:15px; font-weight:700; color:var(--primary);">
              ${(proj.actualRevenue || 0).toLocaleString()}원
            </div>
          </div>
        </div>
      </div>

      <!-- Detail View (hidden by default) -->
      <div id="project-detail-${proj.id}" style="display:none; border-top:1px solid var(--gray-100);">
        <div style="padding:16px 20px;">
          <!-- Tabs -->
          <div style="display:flex; gap:4px; margin-bottom:16px; border-bottom:1px solid var(--gray-100); padding-bottom:8px;">
            <button class="btn btn-ghost btn-sm proj-tab-btn" onclick="switchProjectTab('${proj.id}', 'overview')" style="font-weight:600; background:var(--primary); color:white;" data-proj-tab="${proj.id}-overview">개요</button>
            <button class="btn btn-ghost btn-sm proj-tab-btn" onclick="switchProjectTab('${proj.id}', 'workers')" data-proj-tab="${proj.id}-workers">인력</button>
            <button class="btn btn-ghost btn-sm proj-tab-btn" onclick="switchProjectTab('${proj.id}', 'revenue')" data-proj-tab="${proj.id}-revenue">매출</button>
            <button class="btn btn-ghost btn-sm proj-tab-btn" onclick="switchProjectTab('${proj.id}', 'costs')" data-proj-tab="${proj.id}-costs">비용</button>
            <button class="btn btn-ghost btn-sm proj-tab-btn" onclick="switchProjectTab('${proj.id}', 'memo')" data-proj-tab="${proj.id}-memo">메모</button>
          </div>

          <!-- Tab: Overview -->
          <div id="proj-tab-${proj.id}-overview">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:14px;">
              <div style="background:var(--gray-50); padding:12px 16px; border-radius:8px;">
                <div style="font-size:11px; color:var(--gray-500); font-weight:600;">프로젝트명</div>
                <div style="font-weight:700; margin-top:4px;">${proj.name}</div>
              </div>
              <div style="background:var(--gray-50); padding:12px 16px; border-radius:8px;">
                <div style="font-size:11px; color:var(--gray-500); font-weight:600;">IP/작품명</div>
                <div style="font-weight:700; margin-top:4px;">${proj.ip || '-'}</div>
              </div>
              <div style="background:var(--gray-50); padding:12px 16px; border-radius:8px;">
                <div style="font-size:11px; color:var(--gray-500); font-weight:600;">기간</div>
                <div style="font-weight:700; margin-top:4px;">${proj.startDate || '-'} ~ ${proj.endDate || '-'}</div>
              </div>
              <div style="background:var(--gray-50); padding:12px 16px; border-radius:8px;">
                <div style="font-size:11px; color:var(--gray-500); font-weight:600;">층</div>
                <div style="font-weight:700; margin-top:4px;">${proj.floor || '-'}</div>
              </div>
              <div style="background:var(--gray-50); padding:12px 16px; border-radius:8px;">
                <div style="font-size:11px; color:var(--gray-500); font-weight:600;">투입 인력</div>
                <div style="font-weight:700; margin-top:4px;">${workerCount}명</div>
              </div>
              <div style="background:var(--gray-50); padding:12px 16px; border-radius:8px;">
                <div style="font-size:11px; color:var(--gray-500); font-weight:600;">예상 인건비</div>
                <div style="font-weight:700; margin-top:4px;">${laborCost.toLocaleString()}원</div>
              </div>
            </div>
            <div style="margin-top:16px; display:flex; gap:8px;">
              <button class="btn btn-ghost btn-sm" onclick="openProjectModal('${proj.id}')" style="color:var(--primary);">수정</button>
              <button class="btn btn-ghost btn-sm" onclick="deleteProject('${proj.id}')" style="color:var(--red);">삭제</button>
            </div>
          </div>

          <!-- Tab: Workers -->
          <div id="proj-tab-${proj.id}-workers" style="display:none;">
            <div style="margin-bottom:12px;">
              <button class="btn btn-primary btn-sm" onclick="openWorkerModal('${proj.id}')">+ 알바 배정</button>
            </div>
            ${workerCount === 0 ? '<div class="empty-state"><p>배정된 알바가 없습니다.</p></div>' : `
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>이름</th>
                    <th>연락처</th>
                    <th>시급</th>
                    <th>근무기간</th>
                    <th>근무일수</th>
                    <th>예상 급여</th>
                    <th>메모</th>
                    <th>삭제</th>
                  </tr>
                </thead>
                <tbody>
                  ${proj.workers.map((w, wi) => {
                    const days = w.startDate && w.endDate ? Math.max(1, Math.ceil((new Date(w.endDate) - new Date(w.startDate)) / 86400000) + 1) : 0;
                    const estPay = days * 8 * (w.hourlyRate || 0);
                    return `<tr>
                      <td><strong>${w.name}</strong></td>
                      <td style="font-size:13px;">${w.phone || '-'}</td>
                      <td>${(w.hourlyRate || 0).toLocaleString()}원</td>
                      <td style="font-size:12px;">${w.startDate || '-'} ~ ${w.endDate || '-'}</td>
                      <td>${days}일</td>
                      <td style="font-weight:700;">${estPay.toLocaleString()}원</td>
                      <td style="font-size:12px; color:var(--gray-500);">${w.memo || '-'}</td>
                      <td><button class="btn btn-ghost btn-sm" onclick="deleteProjectWorker('${proj.id}', ${wi})" style="color:var(--red); font-size:12px;">삭제</button></td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>`}
          </div>

          <!-- Tab: Revenue -->
          <div id="proj-tab-${proj.id}-revenue" style="display:none;">
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px;">
              <div style="background:var(--gray-50); padding:16px; border-radius:8px; text-align:center;">
                <div style="font-size:11px; color:var(--gray-500); font-weight:600;">예상 매출</div>
                <div style="font-size:22px; font-weight:800; margin-top:8px;">${(proj.expectedRevenue || 0).toLocaleString()}원</div>
              </div>
              <div style="background:rgba(13,148,136,0.06); padding:16px; border-radius:8px; text-align:center;">
                <div style="font-size:11px; color:var(--gray-500); font-weight:600;">실제 매출</div>
                <div style="font-size:22px; font-weight:800; margin-top:8px; color:var(--primary);">${(proj.actualRevenue || 0).toLocaleString()}원</div>
              </div>
              <div style="background:rgba(239,68,68,0.06); padding:16px; border-radius:8px; text-align:center;">
                <div style="font-size:11px; color:var(--gray-500); font-weight:600;">예상 인건비</div>
                <div style="font-size:22px; font-weight:800; margin-top:8px; color:var(--red);">${laborCost.toLocaleString()}원</div>
              </div>
            </div>
            <div style="margin-top:16px; background:var(--gray-50); padding:16px; border-radius:8px; text-align:center;">
              <div style="font-size:11px; color:var(--gray-500); font-weight:600;">예상 순이익 (실제매출 - 인건비)</div>
              <div style="font-size:26px; font-weight:800; margin-top:8px; color:${((proj.actualRevenue || 0) - laborCost) >= 0 ? 'var(--primary)' : 'var(--red)'};">${((proj.actualRevenue || 0) - laborCost).toLocaleString()}원</div>
            </div>
          </div>

          <!-- Tab: Costs -->
          <div id="proj-tab-${proj.id}-costs" style="display:none;">
            <div>
              <table>
                <thead><tr><th>항목</th><th>내용</th><th>금액</th><th>삭제</th></tr></thead>
                <tbody id="project-costs-${proj.id}">
                </tbody>
                <tfoot>
                  <tr style="font-weight:700;">
                    <td colspan="2">비용 합계</td>
                    <td id="project-cost-total-${proj.id}">₩0</td>
                    <td></td>
                  </tr>
                  <tr style="font-weight:700; color:var(--primary);">
                    <td colspan="2">순익 (매출 - 비용 - 인건비)</td>
                    <td id="project-profit-${proj.id}">₩0</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
              <div style="margin-top:12px; display:flex; gap:8px;">
                <input type="text" id="cost-item-${proj.id}" placeholder="항목 (예: 굿즈 제작비)" style="flex:1; padding:8px; border:1px solid var(--gray-200); border-radius:6px;">
                <input type="text" id="cost-desc-${proj.id}" placeholder="내용" style="flex:1; padding:8px; border:1px solid var(--gray-200); border-radius:6px;">
                <input type="number" id="cost-amount-${proj.id}" placeholder="금액" style="width:120px; padding:8px; border:1px solid var(--gray-200); border-radius:6px;">
                <button class="btn btn-primary btn-sm" onclick="addProjectCost('${proj.id}')">추가</button>
              </div>
            </div>
          </div>

          <!-- Tab: Memo -->
          <div id="proj-tab-${proj.id}-memo" style="display:none;">
            <div style="background:var(--gray-50); padding:16px; border-radius:8px; min-height:100px; white-space:pre-wrap; line-height:1.8; font-size:14px;">
              ${proj.memo || '메모가 없습니다.'}
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

function switchProjectTab(projId, tabName) {
  // Hide all tabs for this project
  const tabs = ['overview', 'workers', 'revenue', 'costs', 'memo'];
  tabs.forEach(t => {
    const tabEl = document.getElementById(`proj-tab-${projId}-${t}`);
    if (tabEl) tabEl.style.display = 'none';
    const btnEl = document.querySelector(`[data-proj-tab="${projId}-${t}"]`);
    if (btnEl) { btnEl.style.background = 'transparent'; btnEl.style.color = 'var(--gray-600)'; }
  });
  // Show selected tab
  const activeTab = document.getElementById(`proj-tab-${projId}-${tabName}`);
  if (activeTab) activeTab.style.display = 'block';
  const activeBtn = document.querySelector(`[data-proj-tab="${projId}-${tabName}"]`);
  if (activeBtn) { activeBtn.style.background = 'var(--primary)'; activeBtn.style.color = 'white'; }
  // Render costs when switching to costs tab
  if (tabName === 'costs') {
    renderProjectCosts(projId);
  }
}

function toggleProjectDetail(id) {
  const detail = document.getElementById('project-detail-' + id);
  if (!detail) return;
  detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
}

function openProjectModal(projectId) {
  const titleEl = document.getElementById('project-modal-title');

  // Reset form
  document.getElementById('project-edit-id').value = '';
  document.getElementById('project-name').value = '';
  document.getElementById('project-ip').value = '';
  document.getElementById('project-status').value = 'preparing';
  document.getElementById('project-floor').value = '4층';
  document.getElementById('project-start-date').value = '';
  document.getElementById('project-end-date').value = '';
  document.getElementById('project-expected-revenue').value = '';
  document.getElementById('project-actual-revenue').value = '';
  document.getElementById('project-memo').value = '';

  if (projectId) {
    titleEl.textContent = '프로젝트 수정';
    document.getElementById('project-edit-id').value = projectId;

    const projects = getProjectStore();
    const proj = projects.find(p => p.id === projectId);
    if (proj) {
      document.getElementById('project-name').value = proj.name || '';
      document.getElementById('project-ip').value = proj.ip || '';
      document.getElementById('project-status').value = proj.status || 'preparing';
      document.getElementById('project-floor').value = proj.floor || '4층';
      document.getElementById('project-start-date').value = proj.startDate || '';
      document.getElementById('project-end-date').value = proj.endDate || '';
      document.getElementById('project-expected-revenue').value = proj.expectedRevenue || '';
      document.getElementById('project-actual-revenue').value = proj.actualRevenue || '';
      document.getElementById('project-memo').value = proj.memo || '';
    }
  } else {
    titleEl.textContent = '프로젝트 생성';
  }

  openModal('project-modal');
}

function saveProject() {
  const editId = document.getElementById('project-edit-id').value;
  const name = document.getElementById('project-name').value.trim();
  const ip = document.getElementById('project-ip').value.trim();
  const status = document.getElementById('project-status').value;
  const floor = document.getElementById('project-floor').value;
  const startDate = document.getElementById('project-start-date').value;
  const endDate = document.getElementById('project-end-date').value;
  const expectedRevenue = parseInt(document.getElementById('project-expected-revenue').value) || 0;
  const actualRevenue = parseInt(document.getElementById('project-actual-revenue').value) || 0;
  const memo = document.getElementById('project-memo').value.trim();

  if (!name) { showToast('프로젝트명을 입력해주세요.', 'error'); return; }
  if (!startDate || !endDate) { showToast('기간을 입력해주세요.', 'error'); return; }

  const projects = getProjectStore();

  if (editId) {
    // Edit existing
    const idx = projects.findIndex(p => p.id === editId);
    if (idx !== -1) {
      projects[idx].name = name;
      projects[idx].ip = ip;
      projects[idx].status = status;
      projects[idx].floor = floor;
      projects[idx].startDate = startDate;
      projects[idx].endDate = endDate;
      projects[idx].expectedRevenue = expectedRevenue;
      projects[idx].actualRevenue = actualRevenue;
      projects[idx].memo = memo;
    }
    showToast('프로젝트가 수정되었습니다.', 'success');
  } else {
    // Create new
    projects.push({
      id: 'proj_' + Date.now(),
      name: name,
      ip: ip,
      status: status,
      startDate: startDate,
      endDate: endDate,
      floor: floor,
      expectedRevenue: expectedRevenue,
      actualRevenue: actualRevenue,
      memo: memo,
      workers: [],
      createdAt: new Date().toISOString().split('T')[0]
    });
    showToast('프로젝트가 생성되었습니다.', 'success');
  }

  setProjectStore(projects);
  closeModal('project-modal');
  loadProjects();
}

function deleteProject(id) {
  if (!confirm('이 프로젝트를 삭제하시겠습니까?')) return;
  const projects = getProjectStore();
  const filtered = projects.filter(p => p.id !== id);
  setProjectStore(filtered);
  showToast('프로젝트가 삭제되었습니다.', 'success');
  loadProjects();
}

function openWorkerModal(projectId) {
  document.getElementById('project-worker-project-id').value = projectId;
  document.getElementById('project-worker-name').value = '';
  document.getElementById('project-worker-phone').value = '';
  document.getElementById('project-worker-rate').value = '10030';
  document.getElementById('project-worker-start').value = '';
  document.getElementById('project-worker-end').value = '';
  document.getElementById('project-worker-memo').value = '';

  // Pre-fill dates from project
  const projects = getProjectStore();
  const proj = projects.find(p => p.id === projectId);
  if (proj) {
    document.getElementById('project-worker-start').value = proj.startDate || '';
    document.getElementById('project-worker-end').value = proj.endDate || '';
  }

  openModal('project-worker-modal');
}

function saveProjectWorker() {
  const projectId = document.getElementById('project-worker-project-id').value;
  const name = document.getElementById('project-worker-name').value.trim();
  const phone = document.getElementById('project-worker-phone').value.trim();
  const hourlyRate = parseInt(document.getElementById('project-worker-rate').value) || 0;
  const startDate = document.getElementById('project-worker-start').value;
  const endDate = document.getElementById('project-worker-end').value;
  const memo = document.getElementById('project-worker-memo').value.trim();

  if (!name) { showToast('이름을 입력해주세요.', 'error'); return; }
  if (!hourlyRate) { showToast('시급을 입력해주세요.', 'error'); return; }

  const projects = getProjectStore();
  const proj = projects.find(p => p.id === projectId);
  if (!proj) { showToast('프로젝트를 찾을 수 없습니다.', 'error'); return; }

  if (!proj.workers) proj.workers = [];
  proj.workers.push({
    id: 'w_' + Date.now(),
    name: name,
    phone: phone,
    hourlyRate: hourlyRate,
    startDate: startDate,
    endDate: endDate,
    memo: memo
  });

  setProjectStore(projects);
  closeModal('project-worker-modal');
  showToast(name + ' 알바가 배정되었습니다.', 'success');
  loadProjects();
}

function deleteProjectWorker(projectId, workerIndex) {
  if (!confirm('이 알바를 삭제하시겠습니까?')) return;
  const projects = getProjectStore();
  const proj = projects.find(p => p.id === projectId);
  if (!proj || !proj.workers) return;

  proj.workers.splice(workerIndex, 1);
  setProjectStore(projects);
  showToast('알바가 삭제되었습니다.', 'success');
  loadProjects();
}

function calculateProjectCost(project) {
  if (!project.workers || project.workers.length === 0) return 0;
  return project.workers.reduce((total, w) => {
    const days = w.startDate && w.endDate ? Math.max(1, Math.ceil((new Date(w.endDate) - new Date(w.startDate)) / 86400000) + 1) : 0;
    const estPay = days * 8 * (w.hourlyRate || 0); // 8 hours per day assumed
    return total + estPay;
  }, 0);
}

// ============================================
// Accounts & Contacts (계정/연락처 관리)
// ============================================

function getAccountStore() {
  try {
    const data = JSON.parse(localStorage.getItem('gm_accounts') || 'null');
    if (data !== null) return data;
  } catch (e) {}

  // Default accounts
  const defaults = [
    { name: '잡코리아/알바몬', purpose: '채용 사이트', username: 'goodsmoment', password: 'goods151', manager: '박정미 본부장' },
    { name: '공용 이메일', purpose: '컨택 등', username: 'biz@goodsmoment.com', password: 'goods151151', manager: '박정미 본부장' },
    { name: '공용 이메일', purpose: 'CS응대', username: 'cs@goodsmoment.com', password: 'goods151151', manager: '박정미 본부장' },
    { name: '홈택스', purpose: '세무', username: 'goodsmoment@hometax.go.kr', password: '', manager: '박정미 본부장' },
    { name: '싸인오케이', purpose: '전자계약', username: 'goodsmoment100@gmail.com', password: '85748574tt*', manager: '' },
    { name: '애플', purpose: 'SNS 운영용', username: '공용 이메일 연동', password: 'Goods151!', manager: '이다비 디자이너' },
    { name: '네이버', purpose: '', username: 'goodsmoment', password: 'goods151!', manager: '이슬 PM' },
    { name: '트위터(X)', purpose: '', username: 'goods_moment', password: 'Goods151!', manager: '이다비 디자이너' },
    { name: '인스타그램', purpose: '', username: 'goods_moment', password: '!o9o9o9o9', manager: '이다비 디자이너' },
    { name: '이지포스', purpose: '매장 포스', username: '2508803575', password: '1769', manager: '' },
    { name: '네이버 스마트플레이스', purpose: '예약', username: 'forrest777', password: 'goods151!', manager: '' },
    { name: '와우프레스', purpose: '발주', username: 'goodsmoment', password: '17691769yys*', manager: '' },
    { name: '에이프린트', purpose: '발주', username: 'biz@goodsmoment.com', password: '17691769yys*', manager: '' },
    { name: '비즈하우스', purpose: '발주', username: 'goodsmoment@naver.com', password: '17691769yys*', manager: '' },
    { name: '이케아', purpose: '구매', username: 'biz@goodsmoment.com', password: 'Goods151!', manager: '' }
  ];
  localStorage.setItem('gm_accounts', JSON.stringify(defaults));
  return defaults;
}

function getContactStore() {
  try {
    const data = JSON.parse(localStorage.getItem('gm_contacts') || 'null');
    if (data !== null) return data;
  } catch (e) {}

  const defaults = [
    { name: '육연식', nameEn: 'YUK YOEN SIK', position: 'CEO / 대표', team: 'IP사업본부', email: 'yys@goodsmoment.com', phone: '010-4433-8574' },
    { name: '유희정', nameEn: 'SUNNY RYU', position: 'CCO / 대표', team: 'IP사업본부', email: 'rhj@goodsmoment.com', phone: '010-9120-2393' },
    { name: '박정미', nameEn: 'PARK JEONG MI', position: 'Director / 본부장', team: 'IP사업본부', email: 'pjm@goodsmoment.com', phone: '010-6271-1005' },
    { name: '이슬', nameEn: 'LEE SEUL', position: 'PM', team: '매장팀', email: 'is@goodsmoment.com', phone: '010-2869-6377' },
    { name: '이다비', nameEn: 'LEE DA BEE', position: 'Designer', team: 'IP사업본부', email: 'idb@goodsmoment.com', phone: '010-3932-3263' },
    { name: '장윤서', nameEn: 'JANG YUN SEO', position: 'Designer', team: 'IP사업본부', email: 'jys@goodsmoment.com', phone: '010-4612-5754' },
    { name: '김형희', nameEn: '', position: '', team: '매장팀', email: '', phone: '010-2972-5350' },
    { name: '문지민', nameEn: '', position: '', team: '매장팀', email: '', phone: '010-8815-0847' },
    { name: '윤진별', nameEn: '', position: '', team: '매장팀', email: '', phone: '010-8351-4397' }
  ];
  localStorage.setItem('gm_contacts', JSON.stringify(defaults));
  return defaults;
}

function getParttimeStore() {
  try {
    const data = JSON.parse(localStorage.getItem('gm_parttime_contacts') || 'null');
    if (data !== null) return data;
  } catch (e) {}

  const defaults = [
    { name: '장주빈', phone: '010-7541-9840', note: '1차' },
    { name: '김아현', phone: '010-5056-6711', note: '1차' },
    { name: '양현지', phone: '010-5012-1656', note: '1차' },
    { name: '박성환', phone: '010-9980-3648', note: '1차' },
    { name: '전여림', phone: '010-8285-3295', note: '1차' },
    { name: '차진아', phone: '010-3110-6208', note: '1차' },
    { name: '이지한', phone: '010-2622-7836', note: '1차' },
    { name: '이재경', phone: '010-7666-7502', note: '1차' }
  ];
  localStorage.setItem('gm_parttime_contacts', JSON.stringify(defaults));
  return defaults;
}

// ---- Accounts Tab Switching ----
function switchAccountsTab(tabName, btnEl) {
  const tabs = ['shared-accounts', 'emergency-contacts', 'parttime-contacts'];
  tabs.forEach(t => {
    const el = document.getElementById('accounts-tab-' + t);
    if (el) el.style.display = 'none';
  });
  document.querySelectorAll('.accounts-tab-btn').forEach(el => {
    el.style.background = 'transparent';
    el.style.color = 'var(--gray-600)';
  });
  const activeTab = document.getElementById('accounts-tab-' + tabName);
  if (activeTab) activeTab.style.display = 'block';
  if (btnEl) {
    btnEl.style.background = 'var(--primary)';
    btnEl.style.color = 'white';
  }
}

// ---- Accounts CRUD ----
function loadAccounts() {
  const accounts = getAccountStore();
  const tbody = document.getElementById('accounts-list');
  if (!tbody) return;

  if (accounts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">등록된 계정이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = accounts.map((acc, idx) => {
    const maskedPw = acc.password ? '\u2022'.repeat(Math.min(acc.password.length, 10)) : '-';
    return `<tr>
      <td><strong>${acc.name}</strong></td>
      <td style="font-size:13px; color:var(--gray-500);">${acc.purpose || '-'}</td>
      <td style="font-size:13px;">${acc.username || '-'}</td>
      <td style="font-size:13px;">
        <span id="pw-display-${idx}">${maskedPw}</span>
        <span id="pw-real-${idx}" style="display:none;">${acc.password || '-'}</span>
        ${acc.password ? `<button onclick="togglePassword(${idx})" style="background:none; border:none; cursor:pointer; padding:2px 6px; font-size:14px; color:var(--gray-400);" title="비밀번호 보기/숨기기" id="pw-toggle-${idx}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>` : ''}
      </td>
      <td style="font-size:13px; color:var(--gray-500);">${acc.manager || '-'}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="openAccountModal(${idx})" style="font-size:12px;">수정</button>
        <button class="btn btn-ghost btn-sm" onclick="deleteAccount(${idx})" style="color:var(--red); font-size:12px;">삭제</button>
      </td>
    </tr>`;
  }).join('');
}

function togglePassword(idx) {
  const display = document.getElementById('pw-display-' + idx);
  const real = document.getElementById('pw-real-' + idx);
  if (!display || !real) return;

  if (real.style.display === 'none') {
    display.style.display = 'none';
    real.style.display = 'inline';
  } else {
    display.style.display = 'inline';
    real.style.display = 'none';
  }
}

function openAccountModal(editIdx) {
  const titleEl = document.getElementById('account-modal-title');
  document.getElementById('account-edit-index').value = '';
  document.getElementById('account-name').value = '';
  document.getElementById('account-purpose').value = '';
  document.getElementById('account-username').value = '';
  document.getElementById('account-password').value = '';
  document.getElementById('account-manager').value = '';

  if (editIdx !== undefined && editIdx !== null) {
    titleEl.textContent = '계정 수정';
    document.getElementById('account-edit-index').value = editIdx;
    const accounts = getAccountStore();
    const acc = accounts[editIdx];
    if (acc) {
      document.getElementById('account-name').value = acc.name || '';
      document.getElementById('account-purpose').value = acc.purpose || '';
      document.getElementById('account-username').value = acc.username || '';
      document.getElementById('account-password').value = acc.password || '';
      document.getElementById('account-manager').value = acc.manager || '';
    }
  } else {
    titleEl.textContent = '계정 추가';
  }
  openModal('account-modal');
}

function saveAccount() {
  const editIdx = document.getElementById('account-edit-index').value;
  const name = document.getElementById('account-name').value.trim();
  const purpose = document.getElementById('account-purpose').value.trim();
  const username = document.getElementById('account-username').value.trim();
  const password = document.getElementById('account-password').value.trim();
  const manager = document.getElementById('account-manager').value.trim();

  if (!name) { showToast('계정명을 입력해주세요.', 'error'); return; }

  const accounts = getAccountStore();

  if (editIdx !== '') {
    accounts[parseInt(editIdx)] = { name, purpose, username, password, manager };
    showToast('계정이 수정되었습니다.', 'success');
  } else {
    accounts.push({ name, purpose, username, password, manager });
    showToast('계정이 추가되었습니다.', 'success');
  }

  localStorage.setItem('gm_accounts', JSON.stringify(accounts));
  closeModal('account-modal');
  loadAccounts();
}

function deleteAccount(idx) {
  if (!confirm('이 계정을 삭제하시겠습니까?')) return;
  const accounts = getAccountStore();
  accounts.splice(idx, 1);
  localStorage.setItem('gm_accounts', JSON.stringify(accounts));
  showToast('계정이 삭제되었습니다.', 'success');
  loadAccounts();
}

// ---- Contacts CRUD ----
function loadContacts() {
  const contacts = getContactStore();
  const tbody = document.getElementById('contacts-list');
  if (!tbody) return;

  if (contacts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">등록된 연락처가 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = contacts.map((c, idx) => {
    return `<tr>
      <td><strong>${c.name}</strong></td>
      <td style="font-size:13px;">${c.nameEn || '-'}</td>
      <td style="font-size:13px;">${c.position || '-'}</td>
      <td style="font-size:13px;">${c.team || '-'}</td>
      <td style="font-size:13px; color:var(--gray-500);">${c.email || '-'}</td>
      <td style="font-size:13px;">${c.phone || '-'}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="openContactModal(${idx})" style="font-size:12px;">수정</button>
        <button class="btn btn-ghost btn-sm" onclick="deleteContact(${idx})" style="color:var(--red); font-size:12px;">삭제</button>
      </td>
    </tr>`;
  }).join('');
}

function openContactModal(editIdx) {
  const titleEl = document.getElementById('contact-modal-title');
  document.getElementById('contact-edit-index').value = '';
  document.getElementById('contact-name').value = '';
  document.getElementById('contact-name-en').value = '';
  document.getElementById('contact-position').value = '';
  document.getElementById('contact-team').value = '';
  document.getElementById('contact-email').value = '';
  document.getElementById('contact-phone').value = '';

  if (editIdx !== undefined && editIdx !== null) {
    titleEl.textContent = '연락처 수정';
    document.getElementById('contact-edit-index').value = editIdx;
    const contacts = getContactStore();
    const c = contacts[editIdx];
    if (c) {
      document.getElementById('contact-name').value = c.name || '';
      document.getElementById('contact-name-en').value = c.nameEn || '';
      document.getElementById('contact-position').value = c.position || '';
      document.getElementById('contact-team').value = c.team || '';
      document.getElementById('contact-email').value = c.email || '';
      document.getElementById('contact-phone').value = c.phone || '';
    }
  } else {
    titleEl.textContent = '연락처 추가';
  }
  openModal('contact-modal');
}

function saveContact() {
  const editIdx = document.getElementById('contact-edit-index').value;
  const name = document.getElementById('contact-name').value.trim();
  const nameEn = document.getElementById('contact-name-en').value.trim();
  const position = document.getElementById('contact-position').value.trim();
  const team = document.getElementById('contact-team').value.trim();
  const email = document.getElementById('contact-email').value.trim();
  const phone = document.getElementById('contact-phone').value.trim();

  if (!name) { showToast('이름을 입력해주세요.', 'error'); return; }

  const contacts = getContactStore();

  if (editIdx !== '') {
    contacts[parseInt(editIdx)] = { name, nameEn, position, team, email, phone };
    showToast('연락처가 수정되었습니다.', 'success');
  } else {
    contacts.push({ name, nameEn, position, team, email, phone });
    showToast('연락처가 추가되었습니다.', 'success');
  }

  localStorage.setItem('gm_contacts', JSON.stringify(contacts));
  closeModal('contact-modal');
  loadContacts();
}

function deleteContact(idx) {
  if (!confirm('이 연락처를 삭제하시겠습니까?')) return;
  const contacts = getContactStore();
  contacts.splice(idx, 1);
  localStorage.setItem('gm_contacts', JSON.stringify(contacts));
  showToast('연락처가 삭제되었습니다.', 'success');
  loadContacts();
}

// ---- Parttime Contacts CRUD ----
function loadParttimeContacts() {
  const contacts = getParttimeStore();
  const tbody = document.getElementById('parttime-contacts-list');
  if (!tbody) return;

  if (contacts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">등록된 연락처가 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = contacts.map((c, idx) => {
    return `<tr>
      <td><strong>${c.name}</strong></td>
      <td style="font-size:13px;">${c.phone || '-'}</td>
      <td style="font-size:13px; color:var(--gray-500);">${c.note || '-'}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="openParttimeModal(${idx})" style="font-size:12px;">수정</button>
        <button class="btn btn-ghost btn-sm" onclick="deleteParttimeContact(${idx})" style="color:var(--red); font-size:12px;">삭제</button>
      </td>
    </tr>`;
  }).join('');
}

function openParttimeModal(editIdx) {
  const titleEl = document.getElementById('parttime-modal-title');
  document.getElementById('parttime-edit-index').value = '';
  document.getElementById('parttime-name').value = '';
  document.getElementById('parttime-phone').value = '';
  document.getElementById('parttime-note').value = '';

  if (editIdx !== undefined && editIdx !== null) {
    titleEl.textContent = '파트타임 연락처 수정';
    document.getElementById('parttime-edit-index').value = editIdx;
    const contacts = getParttimeStore();
    const c = contacts[editIdx];
    if (c) {
      document.getElementById('parttime-name').value = c.name || '';
      document.getElementById('parttime-phone').value = c.phone || '';
      document.getElementById('parttime-note').value = c.note || '';
    }
  } else {
    titleEl.textContent = '파트타임 연락처 추가';
  }
  openModal('parttime-modal');
}

function saveParttimeContact() {
  const editIdx = document.getElementById('parttime-edit-index').value;
  const name = document.getElementById('parttime-name').value.trim();
  const phone = document.getElementById('parttime-phone').value.trim();
  const note = document.getElementById('parttime-note').value.trim();

  if (!name) { showToast('이름을 입력해주세요.', 'error'); return; }

  const contacts = getParttimeStore();

  if (editIdx !== '') {
    contacts[parseInt(editIdx)] = { name, phone, note };
    showToast('연락처가 수정되었습니다.', 'success');
  } else {
    contacts.push({ name, phone, note });
    showToast('연락처가 추가되었습니다.', 'success');
  }

  localStorage.setItem('gm_parttime_contacts', JSON.stringify(contacts));
  closeModal('parttime-modal');
  loadParttimeContacts();
}

function deleteParttimeContact(idx) {
  if (!confirm('이 연락처를 삭제하시겠습니까?')) return;
  const contacts = getParttimeStore();
  contacts.splice(idx, 1);
  localStorage.setItem('gm_parttime_contacts', JSON.stringify(contacts));
  showToast('연락처가 삭제되었습니다.', 'success');
  loadParttimeContacts();
}

// ============================================
// Calendar (전체 일정)
// ============================================

const calCategoryColors = {
  popup: '#9333EA',
  delivery: '#2563EB',
  event: '#16A34A',
  meeting: '#EAB308',
  deadline: '#DC2626',
  other: '#6B7280'
};

const calCategoryLabels = {
  popup: '팝업',
  delivery: '입고/발주',
  event: '이벤트/프로모션',
  meeting: '회의',
  deadline: '마감/중요',
  other: '기타'
};

let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-indexed
let calWeekDate = new Date(); // reference date for week view
let calCurrentView = 'month'; // 'year', 'month', 'week'

function getCalendarStore() {
  try {
    const data = JSON.parse(localStorage.getItem('gm_calendar') || 'null');
    if (data !== null) return data;
  } catch (e) {}

  // Pre-populate sample data
  const defaults = [
    {
      id: 'cal_001',
      title: '청춘블라썸 팝업',
      category: 'popup',
      startDate: '2026-04-01',
      endDate: '2026-04-30',
      time: '',
      location: '4층',
      manager: '이슬',
      memo: '',
      color: '#9333EA',
      createdAt: '2026-03-25T00:00:00.000Z'
    },
    {
      id: 'cal_002',
      title: '화산귀환 팝업',
      category: 'popup',
      startDate: '2026-05-01',
      endDate: '2026-05-17',
      time: '',
      location: '4층',
      manager: '',
      memo: '',
      color: '#9333EA',
      createdAt: '2026-03-25T00:00:00.000Z'
    },
    {
      id: 'cal_003',
      title: '4월 정산 마감',
      category: 'deadline',
      startDate: '2026-04-10',
      endDate: '',
      time: '',
      location: '사무실',
      manager: '박정미',
      memo: '',
      color: '#DC2626',
      createdAt: '2026-03-25T00:00:00.000Z'
    },
    {
      id: 'cal_004',
      title: '제작사 미팅',
      category: 'meeting',
      startDate: '2026-04-15',
      endDate: '',
      time: '14:00',
      location: '사무실',
      manager: '육연식',
      memo: '',
      color: '#EAB308',
      createdAt: '2026-03-25T00:00:00.000Z'
    }
  ];

  localStorage.setItem('gm_calendar', JSON.stringify(defaults));
  return defaults;
}

function setCalendarStore(data) {
  localStorage.setItem('gm_calendar', JSON.stringify(data));
}

function loadCalendar() {
  if (calCurrentView === 'year') {
    renderYearView(calYear);
    renderEventListForYear(calYear);
  } else if (calCurrentView === 'week') {
    renderWeekView(calWeekDate);
    renderEventListForWeek(calWeekDate);
  } else {
    renderCalendarGrid(calYear, calMonth);
    renderEventList(calYear, calMonth);
  }
}

function prevCalMonth() {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  loadCalendar();
}

function nextCalMonth() {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  loadCalendar();
}

function getEventsForDate(dateStr) {
  const store = getCalendarStore();
  return store.filter(ev => {
    const end = ev.endDate || ev.startDate;
    return dateStr >= ev.startDate && dateStr <= end;
  });
}

function renderCalendarGrid(year, month) {
  const label = document.getElementById('cal-month-label');
  if (label) label.textContent = `${year}년 ${String(month + 1).padStart(2, '0')}월`;

  const tbody = document.getElementById('cal-grid-body');
  if (!tbody) return;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  let html = '';
  let dayCount = 1;
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    if (i % 7 === 0) html += '<tr>';

    if (i < firstDay || dayCount > daysInMonth) {
      html += '<td style="padding:8px; vertical-align:top; min-height:80px; height:100px; background:var(--gray-50);"></td>';
    } else {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayCount).padStart(2, '0')}`;
      const isToday = dateStr === todayStr;
      const dayOfWeek = new Date(year, month, dayCount).getDay();
      const isSunday = dayOfWeek === 0;
      const isSaturday = dayOfWeek === 6;

      let cellStyle = 'padding:6px 8px; vertical-align:top; min-height:80px; height:100px; cursor:pointer; transition:background 0.15s;';
      if (isToday) cellStyle += ' border:2px solid var(--primary); background:rgba(13,148,136,0.04);';

      const events = getEventsForDate(dateStr);
      let badgesHtml = '';

      events.slice(0, 3).forEach(ev => {
        const color = ev.color || calCategoryColors[ev.category] || '#6B7280';
        const truncTitle = ev.title.length > 6 ? ev.title.substring(0, 6) + '..' : ev.title;
        badgesHtml += `<div onclick="event.stopPropagation(); openCalendarModal(null, '${ev.id}')" style="display:block; padding:1px 6px; border-radius:4px; font-size:10px; font-weight:600; background:${color}20; color:${color}; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer;" title="${ev.title} | ${calCategoryLabels[ev.category] || ''} | ${ev.location || ''}">${truncTitle}</div>`;
      });

      if (events.length > 3) {
        badgesHtml += `<div style="font-size:10px; color:var(--gray-400); margin-top:2px; text-align:center;">+${events.length - 3}건</div>`;
      }

      const dateColor = isSunday ? 'var(--red)' : (isSaturday ? 'var(--blue)' : 'var(--gray-700)');

      html += `<td style="${cellStyle}" onclick="openCalendarModal('${dateStr}')">
        <div style="font-size:13px; font-weight:700; color:${dateColor}; margin-bottom:2px;">${dayCount}</div>
        <div style="line-height:1.3;">${badgesHtml}</div>
      </td>`;
      dayCount++;
    }

    if (i % 7 === 6) html += '</tr>';
  }

  tbody.innerHTML = html;
}

function renderEventList(year, month) {
  const store = getCalendarStore();
  const tbody = document.getElementById('cal-event-list');
  const countEl = document.getElementById('cal-event-count');
  if (!tbody) return;

  // Get events that overlap this month
  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month + 1, 0).getDate();
  const monthEnd = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const filtered = store.filter(ev => {
    const end = ev.endDate || ev.startDate;
    return ev.startDate <= monthEnd && end >= monthStart;
  }).sort((a, b) => a.startDate.localeCompare(b.startDate));

  if (countEl) countEl.textContent = filtered.length + '건';

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">등록된 일정이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(ev => {
    const color = ev.color || calCategoryColors[ev.category] || '#6B7280';
    const catLabel = calCategoryLabels[ev.category] || ev.category;
    const dateDisplay = ev.endDate && ev.endDate !== ev.startDate
      ? ev.startDate + ' ~ ' + ev.endDate
      : ev.startDate;

    return `<tr>
      <td style="font-size:13px; white-space:nowrap;">${dateDisplay}</td>
      <td><span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; background:${color}20; color:${color};">${catLabel}</span></td>
      <td><strong>${ev.title}</strong></td>
      <td style="font-size:13px; color:var(--gray-500);">${ev.location || '-'}</td>
      <td style="font-size:13px; color:var(--gray-500);">${ev.time || '-'}</td>
      <td style="font-size:13px;">${ev.manager || '-'}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="openCalendarModal(null, '${ev.id}')" style="font-size:12px;">수정</button>
      </td>
    </tr>`;
  }).join('');
}

function openCalendarModal(dateStr, eventId) {
  const titleEl = document.getElementById('calendar-modal-title');
  const deleteBtn = document.getElementById('cal-delete-btn');

  // Reset form
  document.getElementById('cal-edit-id').value = '';
  document.getElementById('cal-title').value = '';
  document.getElementById('cal-category').value = 'popup';
  document.getElementById('cal-start-date').value = dateStr || '';
  document.getElementById('cal-end-date').value = '';
  document.getElementById('cal-time').value = '';
  document.getElementById('cal-location').value = '전체';
  document.getElementById('cal-manager').value = '';
  document.getElementById('cal-memo').value = '';
  deleteBtn.style.display = 'none';
  updateCalColor();

  if (eventId) {
    // Edit mode
    titleEl.textContent = '일정 수정';
    document.getElementById('cal-edit-id').value = eventId;
    deleteBtn.style.display = 'inline-flex';

    const store = getCalendarStore();
    const ev = store.find(e => e.id === eventId);
    if (ev) {
      document.getElementById('cal-title').value = ev.title || '';
      document.getElementById('cal-category').value = ev.category || 'popup';
      document.getElementById('cal-start-date').value = ev.startDate || '';
      document.getElementById('cal-end-date').value = ev.endDate || '';
      document.getElementById('cal-time').value = ev.time || '';
      document.getElementById('cal-location').value = ev.location || '전체';
      document.getElementById('cal-manager').value = ev.manager || '';
      document.getElementById('cal-memo').value = ev.memo || '';
      updateCalColor();
    }
  } else {
    titleEl.textContent = '일정 등록';
  }

  openModal('calendar-modal');
}

function updateCalColor() {
  const category = document.getElementById('cal-category').value;
  const color = calCategoryColors[category] || '#6B7280';
  const label = calCategoryLabels[category] || '기타';
  const preview = document.getElementById('cal-color-preview');
  const labelEl = document.getElementById('cal-color-label');
  if (preview) preview.style.background = color;
  if (labelEl) labelEl.textContent = label;
}

function saveCalendarEvent() {
  const editId = document.getElementById('cal-edit-id').value;
  const title = document.getElementById('cal-title').value.trim();
  const category = document.getElementById('cal-category').value;
  const startDate = document.getElementById('cal-start-date').value;
  const endDate = document.getElementById('cal-end-date').value;
  const time = document.getElementById('cal-time').value;
  const location = document.getElementById('cal-location').value;
  const manager = document.getElementById('cal-manager').value.trim();
  const memo = document.getElementById('cal-memo').value.trim();
  const color = calCategoryColors[category] || '#6B7280';

  if (!title) { showToast('제목을 입력해주세요.', 'error'); return; }
  if (!startDate) { showToast('시작일을 입력해주세요.', 'error'); return; }

  const store = getCalendarStore();

  if (editId) {
    const idx = store.findIndex(e => e.id === editId);
    if (idx !== -1) {
      store[idx].title = title;
      store[idx].category = category;
      store[idx].startDate = startDate;
      store[idx].endDate = endDate;
      store[idx].time = time;
      store[idx].location = location;
      store[idx].manager = manager;
      store[idx].memo = memo;
      store[idx].color = color;
    }
    showToast('일정이 수정되었습니다.', 'success');
  } else {
    store.push({
      id: 'cal_' + Date.now(),
      title,
      category,
      startDate,
      endDate,
      time,
      location,
      manager,
      memo,
      color,
      createdAt: new Date().toISOString()
    });
    showToast('일정이 등록되었습니다.', 'success');
  }

  setCalendarStore(store);
  closeModal('calendar-modal');
  loadCalendar();
}

function deleteCalendarEvent(id) {
  // If called from modal without id, get from hidden field
  if (!id) id = document.getElementById('cal-edit-id').value;
  if (!id) return;
  if (!confirm('이 일정을 삭제하시겠습니까?')) return;

  const store = getCalendarStore();
  const filtered = store.filter(e => e.id !== id);
  setCalendarStore(filtered);
  closeModal('calendar-modal');
  showToast('일정이 삭제되었습니다.', 'success');
  loadCalendar();
}

// ============================================
// Calendar View Switching & Year/Week Views
// ============================================

function switchCalView(view) {
  calCurrentView = view;

  // Toggle view containers
  const yearView = document.getElementById('cal-year-view');
  const monthView = document.getElementById('cal-month-view');
  const weekView = document.getElementById('cal-week-view');
  if (yearView) yearView.style.display = view === 'year' ? '' : 'none';
  if (monthView) monthView.style.display = view === 'month' ? '' : 'none';
  if (weekView) weekView.style.display = view === 'week' ? '' : 'none';

  // Toggle navigation
  const navYear = document.getElementById('cal-nav-year');
  const navMonth = document.getElementById('cal-nav-month');
  const navWeek = document.getElementById('cal-nav-week');
  if (navYear) navYear.style.display = view === 'year' ? 'flex' : 'none';
  if (navMonth) navMonth.style.display = view === 'month' ? 'flex' : 'none';
  if (navWeek) navWeek.style.display = view === 'week' ? 'flex' : 'none';

  // Update button styles
  const btnYear = document.getElementById('cal-view-year');
  const btnMonth = document.getElementById('cal-view-month');
  const btnWeek = document.getElementById('cal-view-week');
  [btnYear, btnMonth, btnWeek].forEach(btn => {
    if (btn) { btn.style.background = 'var(--gray-100)'; btn.style.color = 'var(--gray-600)'; }
  });
  const activeBtn = view === 'year' ? btnYear : (view === 'week' ? btnWeek : btnMonth);
  if (activeBtn) { activeBtn.style.background = 'var(--primary)'; activeBtn.style.color = 'white'; }

  // Update event list title
  const listTitle = document.getElementById('cal-event-list-title');
  if (listTitle) {
    if (view === 'year') listTitle.textContent = '연간 일정 리스트';
    else if (view === 'week') listTitle.textContent = '이번 주 일정 리스트';
    else listTitle.textContent = '이번 달 일정 리스트';
  }

  // Sync dates between views
  if (view === 'week') {
    calWeekDate = new Date(calYear, calMonth, new Date().getDate());
  }

  loadCalendar();
}

function prevCalYear() {
  calYear--;
  loadCalendar();
}

function nextCalYear() {
  calYear++;
  loadCalendar();
}

function prevCalWeek() {
  calWeekDate.setDate(calWeekDate.getDate() - 7);
  loadCalendar();
}

function nextCalWeek() {
  calWeekDate.setDate(calWeekDate.getDate() + 7);
  loadCalendar();
}

function getWeekMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday as start
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function renderYearView(year) {
  const label = document.getElementById('cal-year-label');
  if (label) label.textContent = `${year}년`;

  const container = document.getElementById('cal-year-grid');
  if (!container) return;

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];

  let html = '<div style="display:grid; grid-template-columns:repeat(4,1fr); gap:16px;">';

  for (let m = 0; m < 12; m++) {
    const firstDay = new Date(year, m, 1).getDay();
    const daysInMonth = new Date(year, m + 1, 0).getDate();

    html += `<div class="card" style="padding:12px;">`;
    html += `<div style="font-weight:700; text-align:center; margin-bottom:8px; cursor:pointer; color:var(--primary);" onclick="calYear=${year}; calMonth=${m}; switchCalView('month');">${m + 1}월</div>`;

    // Day name headers
    html += '<div style="display:grid; grid-template-columns:repeat(7,1fr); gap:1px; font-size:9px; text-align:center; margin-bottom:2px;">';
    dayNames.forEach((dn, di) => {
      const color = di === 0 ? 'var(--red)' : (di === 6 ? 'var(--blue)' : 'var(--gray-400)');
      html += `<div style="color:${color}; font-weight:600;">${dn}</div>`;
    });
    html += '</div>';

    // Day grid
    html += '<div style="display:grid; grid-template-columns:repeat(7,1fr); gap:1px; font-size:10px; text-align:center;">';

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
      html += '<div style="padding:2px;"></div>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const isToday = dateStr === todayStr;
      const dayOfWeek = new Date(year, m, d).getDay();
      const events = getEventsForDate(dateStr);

      let cellStyle = 'padding:2px; cursor:pointer; border-radius:3px; position:relative;';
      if (isToday) cellStyle += ' background:var(--primary); color:white; font-weight:700;';
      else if (dayOfWeek === 0) cellStyle += ' color:var(--red);';
      else if (dayOfWeek === 6) cellStyle += ' color:var(--blue);';

      let dotHtml = '';
      if (events.length > 0) {
        const dotColor = events[0].color || '#6B7280';
        dotHtml = `<div style="position:absolute; bottom:0; left:50%; transform:translateX(-50%); width:4px; height:4px; border-radius:50%; background:${dotColor};"></div>`;
      }

      html += `<div style="${cellStyle}" onclick="calYear=${year}; calMonth=${m}; switchCalView('month');" title="${events.length > 0 ? events.map(e => e.title).join(', ') : ''}">${d}${dotHtml}</div>`;
    }

    html += '</div></div>';
  }

  html += '</div>';
  container.innerHTML = html;
}

function renderWeekView(date) {
  const monday = getWeekMonday(date);
  const container = document.getElementById('cal-week-grid');
  if (!container) return;

  // Update label
  const label = document.getElementById('cal-week-label');
  if (label) {
    const weekEnd = new Date(monday);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const mStart = monday.getMonth() + 1;
    const mEnd = weekEnd.getMonth() + 1;
    const weekNum = Math.ceil(monday.getDate() / 7);
    if (mStart === mEnd) {
      label.textContent = `${monday.getFullYear()}년 ${String(mStart).padStart(2, '0')}월 ${weekNum}주`;
    } else {
      label.textContent = `${monday.getFullYear()}년 ${String(mStart).padStart(2, '0')}월 ~ ${String(mEnd).padStart(2, '0')}월`;
    }
  }

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const dayNames = ['월', '화', '수', '목', '금', '토', '일'];

  let html = '<div style="display:grid; grid-template-columns:repeat(7,1fr); gap:8px;">';

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const dayOfWeek = d.getDay();
    const isWednesday = dayOfWeek === 3;

    const headerBg = isToday ? 'var(--primary)' : 'var(--gray-50)';
    const headerColor = isToday ? 'white' : (dayOfWeek === 0 ? 'var(--red)' : (dayOfWeek === 6 ? 'var(--blue)' : 'var(--gray-700)'));
    const borderStyle = isToday ? 'border:2px solid var(--primary);' : 'border:1px solid var(--gray-200);';

    html += `<div style="min-height:300px; ${borderStyle} border-radius:10px; overflow:hidden;">`;
    html += `<div style="text-align:center; padding:10px 8px; font-weight:700; background:${headerBg}; color:${headerColor};">`;
    html += `${d.getMonth() + 1}/${d.getDate()}<br><span style="font-size:11px; font-weight:500;">${dayNames[i]}</span>`;
    html += '</div>';

    html += '<div style="padding:6px;">';

    // Wednesday store closed banner
    if (isWednesday) {
      html += '<div style="padding:6px 8px; margin-bottom:6px; border-radius:6px; font-size:11px; font-weight:600; background:var(--gray-100); color:var(--gray-500); text-align:center;">매장 휴무</div>';
    }

    const events = getEventsForDate(dateStr);
    events.sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    events.forEach(ev => {
      const color = ev.color || calCategoryColors[ev.category] || '#6B7280';
      const catLabel = calCategoryLabels[ev.category] || '';
      html += `<div onclick="openCalendarModal(null, '${ev.id}')" style="padding:6px 8px; margin-bottom:4px; border-radius:6px; font-size:12px; background:${color}15; border-left:3px solid ${color}; cursor:pointer;" title="${ev.title}">`;
      html += `<div style="font-weight:600; margin-bottom:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${ev.title}</div>`;
      if (ev.time) html += `<span style="font-size:10px; color:var(--gray-500);">${ev.time}</span> `;
      if (ev.location) html += `<span style="font-size:10px; color:var(--gray-400);">${ev.location}</span>`;
      if (catLabel) html += `<div style="font-size:9px; color:${color}; margin-top:2px;">${catLabel}</div>`;
      html += '</div>';
    });

    if (events.length === 0 && !isWednesday) {
      html += '<div style="font-size:11px; color:var(--gray-300); text-align:center; padding:20px 0;">일정 없음</div>';
    }

    html += '</div></div>';
  }

  html += '</div>';
  container.innerHTML = html;
}

function renderEventListForYear(year) {
  const store = getCalendarStore();
  const tbody = document.getElementById('cal-event-list');
  const countEl = document.getElementById('cal-event-count');
  if (!tbody) return;

  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const filtered = store.filter(ev => {
    const end = ev.endDate || ev.startDate;
    return ev.startDate <= yearEnd && end >= yearStart;
  }).sort((a, b) => a.startDate.localeCompare(b.startDate));

  if (countEl) countEl.textContent = filtered.length + '건';

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">등록된 일정이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(ev => {
    const color = ev.color || calCategoryColors[ev.category] || '#6B7280';
    const catLabel = calCategoryLabels[ev.category] || ev.category;
    const dateDisplay = ev.endDate && ev.endDate !== ev.startDate
      ? ev.startDate + ' ~ ' + ev.endDate
      : ev.startDate;

    return `<tr>
      <td style="font-size:13px; white-space:nowrap;">${dateDisplay}</td>
      <td><span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; background:${color}20; color:${color};">${catLabel}</span></td>
      <td><strong>${ev.title}</strong></td>
      <td style="font-size:13px; color:var(--gray-500);">${ev.location || '-'}</td>
      <td style="font-size:13px; color:var(--gray-500);">${ev.time || '-'}</td>
      <td style="font-size:13px;">${ev.manager || '-'}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="openCalendarModal(null, '${ev.id}')" style="font-size:12px;">수정</button>
      </td>
    </tr>`;
  }).join('');
}

function renderEventListForWeek(date) {
  const monday = getWeekMonday(date);
  const store = getCalendarStore();
  const tbody = document.getElementById('cal-event-list');
  const countEl = document.getElementById('cal-event-count');
  if (!tbody) return;

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekStart = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
  const weekEnd = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, '0')}-${String(sunday.getDate()).padStart(2, '0')}`;

  const filtered = store.filter(ev => {
    const end = ev.endDate || ev.startDate;
    return ev.startDate <= weekEnd && end >= weekStart;
  }).sort((a, b) => a.startDate.localeCompare(b.startDate));

  if (countEl) countEl.textContent = filtered.length + '건';

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">등록된 일정이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(ev => {
    const color = ev.color || calCategoryColors[ev.category] || '#6B7280';
    const catLabel = calCategoryLabels[ev.category] || ev.category;
    const dateDisplay = ev.endDate && ev.endDate !== ev.startDate
      ? ev.startDate + ' ~ ' + ev.endDate
      : ev.startDate;

    return `<tr>
      <td style="font-size:13px; white-space:nowrap;">${dateDisplay}</td>
      <td><span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; background:${color}20; color:${color};">${catLabel}</span></td>
      <td><strong>${ev.title}</strong></td>
      <td style="font-size:13px; color:var(--gray-500);">${ev.location || '-'}</td>
      <td style="font-size:13px; color:var(--gray-500);">${ev.time || '-'}</td>
      <td style="font-size:13px;">${ev.manager || '-'}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="openCalendarModal(null, '${ev.id}')" style="font-size:12px;">수정</button>
      </td>
    </tr>`;
  }).join('');
}

// ============================================
// Mobile Menu
// ============================================

function toggleMobileMenu() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const btn = document.getElementById('mobile-menu-btn');
  if (!sidebar || !overlay) return;
  sidebar.classList.toggle('open');
  overlay.classList.toggle('active');
  if (btn) btn.textContent = sidebar.classList.contains('open') ? '\u2715' : '\u2630';
}

// Auto-close sidebar on nav click (mobile)
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.nav-item').forEach(function(item) {
    item.addEventListener('click', function() {
      if (window.innerWidth <= 768) {
        var sidebar = document.querySelector('.sidebar');
        var overlay = document.getElementById('sidebar-overlay');
        var btn = document.getElementById('mobile-menu-btn');
        if (sidebar) sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
        if (btn) btn.textContent = '\u2630';
      }
    });
  });
});

// ============================================
// Messages (메시지)
// ============================================

function getMessageStore() {
  try {
    var data = JSON.parse(localStorage.getItem('gm_messages') || 'null');
    if (data !== null) return data;
  } catch (e) {}

  // Pre-populate sample messages
  var defaults = [
    {
      id: 'msg_001',
      from: 'system_pjm',
      fromName: '박정미',
      to: 'all',
      toName: '전체',
      content: '4월 정산 자료 준비 부탁드립니다',
      createdAt: '2026-04-03T10:00:00'
    },
    {
      id: 'msg_002',
      from: 'system_ls',
      fromName: '이슬',
      to: 'all',
      toName: '전체',
      content: '내일 2층 디피 변경 예정입니다',
      createdAt: '2026-04-03T14:30:00'
    }
  ];
  localStorage.setItem('gm_messages', JSON.stringify(defaults));
  return defaults;
}

function setMessageStore(data) {
  localStorage.setItem('gm_messages', JSON.stringify(data));
}

async function loadMessages() {
  var user = await getCurrentUser();
  var messages = getMessageStore();
  var listEl = document.getElementById('message-list');
  if (!listEl) return;

  var myId = user ? user.id : '';
  var myName = (user && user.profile) ? user.profile.name : '';

  if (messages.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><p>메시지가 없습니다.</p></div>';
    return;
  }

  // Sort newest first
  var sorted = messages.slice().sort(function(a, b) {
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  listEl.innerHTML = sorted.map(function(msg) {
    var isMine = (msg.from === myId || msg.fromName === myName);
    var isAll = (msg.to === 'all');
    var timeStr = new Date(msg.createdAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    var toLabel = isAll ? '<span style="display:inline-block; padding:1px 6px; border-radius:4px; font-size:11px; font-weight:600; background:var(--blue-bg); color:var(--blue);">전체</span>' : msg.toName;

    var align = isMine ? 'flex-end' : 'flex-start';
    var bubbleClass = isMine ? 'mine' : (isAll ? 'broadcast' : 'others');

    return '<div style="display:flex; flex-direction:column; align-items:' + align + '; margin-bottom:16px;">' +
      '<div style="font-size:11px; color:var(--gray-400); margin-bottom:4px;">' +
        '<strong style="color:var(--gray-700);">' + msg.fromName + '</strong>' +
        ' &rarr; ' + toLabel +
        ' &middot; ' + timeStr +
      '</div>' +
      '<div class="message-bubble ' + bubbleClass + '">' + msg.content.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>' +
    '</div>';
  }).join('');
}

async function openMessageModal() {
  var toSelect = document.getElementById('message-to');
  if (!toSelect) return;

  // Populate recipients from profiles
  try {
    var result = await sb.from('profiles').select('id, name, department').order('name');
    var members = result.data;
    if (members && members.length > 0) {
      toSelect.innerHTML = '<option value="all">전체</option>' +
        members.map(function(m) {
          return '<option value="' + m.id + '" data-name="' + m.name + '">' + m.name + ' (' + (m.department || '미지정') + ')</option>';
        }).join('');
    }
  } catch (e) {
    // If Supabase fails, use contacts from localStorage as fallback
    var contacts = getContactStore();
    toSelect.innerHTML = '<option value="all">전체</option>' +
      contacts.map(function(c) {
        return '<option value="local_' + c.name + '" data-name="' + c.name + '">' + c.name + '</option>';
      }).join('');
  }

  document.getElementById('message-content').value = '';
  openModal('message-modal');
}

async function sendMessage() {
  var toSelect = document.getElementById('message-to');
  var content = document.getElementById('message-content').value.trim();

  if (!content) {
    showToast('메시지 내용을 입력해주세요.', 'error');
    return;
  }

  var user = await getCurrentUser();
  var fromId = user ? user.id : 'unknown';
  var fromName = (user && user.profile) ? user.profile.name : '나';

  var toValue = toSelect.value;
  var selectedOption = toSelect.options[toSelect.selectedIndex];
  var toName = toValue === 'all' ? '전체' : (selectedOption.getAttribute('data-name') || toValue);

  var messages = getMessageStore();
  messages.push({
    id: 'msg_' + Date.now(),
    from: fromId,
    fromName: fromName,
    to: toValue,
    toName: toName,
    content: content,
    createdAt: new Date().toISOString()
  });

  setMessageStore(messages);
  closeModal('message-modal');
  showToast('메시지가 전송되었습니다.', 'success');
  loadMessages();
}

// ============================================
// Inventory Management (재고관리)
// ============================================

function getInventoryStore() {
  try {
    var data = JSON.parse(localStorage.getItem('gm_inventory') || 'null');
    if (data !== null) return data;
  } catch (e) {}

  // Pre-populate sample items
  var defaults = [
    { publisher: '북극여우', name: '꿈이상 아크릴 키링', currentStock: 45, minStock: 10, lastReceived: '2026-03-20' },
    { publisher: '북극여우', name: '향막 포스터 세트', currentStock: 8, minStock: 15, lastReceived: '2026-03-15' },
    { publisher: '작두', name: '작두 스티커팩', currentStock: 120, minStock: 20, lastReceived: '2026-03-25' },
    { publisher: '작두', name: '작두 엽서 세트', currentStock: 0, minStock: 10, lastReceived: '2026-02-28' },
    { publisher: '킬러배드로', name: '킬배 미니피규어', currentStock: 32, minStock: 10, lastReceived: '2026-03-28' },
    { publisher: '킬러배드로', name: '킬배 폰케이스', currentStock: 5, minStock: 8, lastReceived: '2026-03-10' }
  ];
  localStorage.setItem('gm_inventory', JSON.stringify(defaults));
  return defaults;
}

function getReceivingStore() {
  try {
    var data = JSON.parse(localStorage.getItem('gm_receiving') || 'null');
    if (data !== null) return data;
  } catch (e) {}

  var defaults = [
    { date: '2026-03-28', publisher: '킬러배드로', name: '킬배 미니피규어', expectedQty: 50, actualQty: 50, status: 'completed', checker: '이슬' },
    { date: '2026-03-25', publisher: '작두', name: '작두 스티커팩', expectedQty: 100, actualQty: 100, status: 'completed', checker: '김형희' },
    { date: '2026-04-05', publisher: '북극여우', name: '향막 포스터 세트', expectedQty: 30, actualQty: 0, status: 'expected', checker: '' }
  ];
  localStorage.setItem('gm_receiving', JSON.stringify(defaults));
  return defaults;
}

function getOrderStore() {
  try {
    var data = JSON.parse(localStorage.getItem('gm_orders') || 'null');
    if (data !== null) return data;
  } catch (e) {}

  var defaults = [
    { date: '2026-04-02', publisher: '작두', name: '작두 엽서 세트', qty: 50, status: 'requested', requester: '문지민' },
    { date: '2026-04-03', publisher: '북극여우', name: '향막 포스터 세트', qty: 30, status: 'ordered', requester: '이슬' }
  ];
  localStorage.setItem('gm_orders', JSON.stringify(defaults));
  return defaults;
}

function loadInventory() {
  renderInventoryStock();
  renderReceiving();
  renderOrders();
  checkLowStock();
}

function switchInventoryTab(tabName, btnEl) {
  var tabs = ['stock', 'receiving', 'orders'];
  tabs.forEach(function(t) {
    var el = document.getElementById('inv-tab-' + t);
    if (el) el.style.display = 'none';
  });
  document.querySelectorAll('.inv-tab-btn').forEach(function(el) {
    el.style.background = 'transparent';
    el.style.color = 'var(--gray-600)';
  });
  var activeTab = document.getElementById('inv-tab-' + tabName);
  if (activeTab) activeTab.style.display = 'block';
  if (btnEl) {
    btnEl.style.background = 'var(--primary)';
    btnEl.style.color = 'white';
  }
}

function renderInventoryStock() {
  var items = getInventoryStore();
  var tbody = document.getElementById('inventory-stock-list');
  if (!tbody) return;

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">등록된 상품이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = items.map(function(item, idx) {
    var statusText, statusClass, warn;
    if (item.currentStock <= 0) {
      statusText = '품절'; statusClass = 'background:var(--red-bg); color:var(--red);'; warn = '';
    } else if (item.currentStock < item.minStock) {
      statusText = '부족'; statusClass = 'background:var(--yellow-bg); color:#B8860B;'; warn = ' \u26A0\uFE0F';
    } else {
      statusText = '정상'; statusClass = 'background:var(--green-bg); color:var(--green);'; warn = '';
    }

    return '<tr>' +
      '<td>' + item.publisher + '</td>' +
      '<td><strong>' + item.name + '</strong>' + warn + '</td>' +
      '<td style="font-weight:700;">' + item.currentStock + '</td>' +
      '<td>' + item.minStock + '</td>' +
      '<td><span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; ' + statusClass + '">' + statusText + '</span></td>' +
      '<td style="font-size:13px; color:var(--gray-500);">' + (item.lastReceived || '-') + '</td>' +
      '<td>' +
        '<button class="btn btn-ghost btn-sm" onclick="editInventoryItem(' + idx + ')" style="font-size:12px;">수정</button>' +
        '<button class="btn btn-ghost btn-sm" onclick="deleteInventoryItem(' + idx + ')" style="color:var(--red); font-size:12px;">삭제</button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function saveInventoryItem() {
  var editIdx = document.getElementById('inv-edit-index').value;
  var publisher = document.getElementById('inv-publisher').value.trim();
  var name = document.getElementById('inv-product-name').value.trim();
  var currentStock = parseInt(document.getElementById('inv-current-stock').value) || 0;
  var minStock = parseInt(document.getElementById('inv-min-stock').value) || 10;
  var lastReceived = document.getElementById('inv-last-received').value;

  if (!publisher) { showToast('제작사를 입력해주세요.', 'error'); return; }
  if (!name) { showToast('상품명을 입력해주세요.', 'error'); return; }

  var items = getInventoryStore();

  if (editIdx !== '') {
    items[parseInt(editIdx)] = { publisher: publisher, name: name, currentStock: currentStock, minStock: minStock, lastReceived: lastReceived };
    showToast('상품 정보가 수정되었습니다.', 'success');
  } else {
    items.push({ publisher: publisher, name: name, currentStock: currentStock, minStock: minStock, lastReceived: lastReceived });
    showToast('상품이 등록되었습니다.', 'success');
  }

  localStorage.setItem('gm_inventory', JSON.stringify(items));
  closeModal('inventory-modal');
  loadInventory();
}

function editInventoryItem(idx) {
  var items = getInventoryStore();
  var item = items[idx];
  if (!item) return;

  document.getElementById('inv-edit-index').value = idx;
  document.getElementById('inv-publisher').value = item.publisher || '';
  document.getElementById('inv-product-name').value = item.name || '';
  document.getElementById('inv-current-stock').value = item.currentStock || 0;
  document.getElementById('inv-min-stock').value = item.minStock || 10;
  document.getElementById('inv-last-received').value = item.lastReceived || '';

  openModal('inventory-modal');
}

function deleteInventoryItem(idx) {
  if (!confirm('이 상품을 삭제하시겠습니까?')) return;
  var items = getInventoryStore();
  items.splice(idx, 1);
  localStorage.setItem('gm_inventory', JSON.stringify(items));
  showToast('상품이 삭제되었습니다.', 'success');
  loadInventory();
}

function renderReceiving() {
  var records = getReceivingStore();
  var tbody = document.getElementById('inventory-receiving-list');
  if (!tbody) return;

  if (records.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">입고 기록이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = records.map(function(rec, idx) {
    var diff = rec.actualQty - rec.expectedQty;
    var diffText = diff === 0 ? '-' : (diff > 0 ? '+' + diff : '' + diff);
    var statusText, statusStyle;
    if (rec.status === 'expected') {
      statusText = '예정'; statusStyle = 'background:var(--blue-bg); color:var(--blue);';
    } else if (rec.expectedQty !== rec.actualQty && rec.status === 'completed') {
      statusText = '불일치'; statusStyle = 'background:var(--red-bg); color:var(--red);';
    } else {
      statusText = '완료'; statusStyle = 'background:var(--green-bg); color:var(--green);';
    }

    return '<tr>' +
      '<td style="font-size:13px;">' + rec.date + '</td>' +
      '<td>' + rec.publisher + '</td>' +
      '<td><strong>' + rec.name + '</strong></td>' +
      '<td>' + rec.expectedQty + '</td>' +
      '<td>' + (rec.actualQty || '-') + '</td>' +
      '<td style="font-weight:700; color:' + (diff !== 0 && rec.status !== 'expected' ? 'var(--red)' : 'var(--gray-500)') + ';">' + diffText + '</td>' +
      '<td><span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; ' + statusStyle + '">' + statusText + '</span></td>' +
      '<td style="font-size:13px;">' + (rec.checker || '-') + '</td>' +
      '<td><button class="btn btn-ghost btn-sm" onclick="deleteReceiving(' + idx + ')" style="color:var(--red); font-size:12px;">삭제</button></td>' +
    '</tr>';
  }).join('');
}

function saveReceiving() {
  var date = document.getElementById('recv-date').value;
  var publisher = document.getElementById('recv-publisher').value.trim();
  var name = document.getElementById('recv-product-name').value.trim();
  var expectedQty = parseInt(document.getElementById('recv-expected-qty').value) || 0;
  var actualQty = parseInt(document.getElementById('recv-actual-qty').value) || 0;
  var checker = document.getElementById('recv-checker').value.trim();

  if (!date) { showToast('입고일을 입력해주세요.', 'error'); return; }
  if (!publisher) { showToast('제작사를 입력해주세요.', 'error'); return; }
  if (!name) { showToast('상품명을 입력해주세요.', 'error'); return; }

  var status = actualQty > 0 ? 'completed' : 'expected';

  var records = getReceivingStore();
  records.unshift({ date: date, publisher: publisher, name: name, expectedQty: expectedQty, actualQty: actualQty, status: status, checker: checker });
  localStorage.setItem('gm_receiving', JSON.stringify(records));

  // Update inventory stock if completed
  if (status === 'completed' && actualQty > 0) {
    var items = getInventoryStore();
    var found = false;
    for (var i = 0; i < items.length; i++) {
      if (items[i].publisher === publisher && items[i].name === name) {
        items[i].currentStock += actualQty;
        items[i].lastReceived = date;
        found = true;
        break;
      }
    }
    if (!found) {
      items.push({ publisher: publisher, name: name, currentStock: actualQty, minStock: 10, lastReceived: date });
    }
    localStorage.setItem('gm_inventory', JSON.stringify(items));
  }

  closeModal('receiving-modal');
  // Reset form
  document.getElementById('recv-date').value = '';
  document.getElementById('recv-publisher').value = '';
  document.getElementById('recv-product-name').value = '';
  document.getElementById('recv-expected-qty').value = '';
  document.getElementById('recv-actual-qty').value = '';
  document.getElementById('recv-checker').value = '';

  showToast('입고가 등록되었습니다.', 'success');
  loadInventory();
}

function deleteReceiving(idx) {
  if (!confirm('이 입고 기록을 삭제하시겠습니까?')) return;
  var records = getReceivingStore();
  records.splice(idx, 1);
  localStorage.setItem('gm_receiving', JSON.stringify(records));
  showToast('입고 기록이 삭제되었습니다.', 'success');
  renderReceiving();
}

function renderOrders() {
  var orders = getOrderStore();
  var tbody = document.getElementById('inventory-order-list');
  if (!tbody) return;

  if (orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">발주 요청이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = orders.map(function(order, idx) {
    var statusText, statusStyle;
    if (order.status === 'requested') {
      statusText = '요청'; statusStyle = 'background:var(--yellow-bg); color:#B8860B;';
    } else if (order.status === 'ordered') {
      statusText = '발주완료'; statusStyle = 'background:var(--blue-bg); color:var(--blue);';
    } else {
      statusText = '입고완료'; statusStyle = 'background:var(--green-bg); color:var(--green);';
    }

    return '<tr>' +
      '<td style="font-size:13px;">' + order.date + '</td>' +
      '<td>' + order.publisher + '</td>' +
      '<td><strong>' + order.name + '</strong></td>' +
      '<td>' + order.qty + '</td>' +
      '<td><span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; ' + statusStyle + '">' + statusText + '</span></td>' +
      '<td style="font-size:13px;">' + (order.requester || '-') + '</td>' +
      '<td>' +
        (order.status === 'requested' ? '<button class="btn btn-ghost btn-sm" onclick="updateOrderStatus(' + idx + ', \'ordered\')" style="font-size:12px; color:var(--blue);">발주완료</button>' : '') +
        (order.status === 'ordered' ? '<button class="btn btn-ghost btn-sm" onclick="updateOrderStatus(' + idx + ', \'received\')" style="font-size:12px; color:var(--green);">입고완료</button>' : '') +
        '<button class="btn btn-ghost btn-sm" onclick="deleteOrder(' + idx + ')" style="color:var(--red); font-size:12px;">삭제</button>' +
      '</td>' +
    '</tr>';
  }).join('');
}

function saveOrder() {
  var publisher = document.getElementById('order-publisher').value.trim();
  var name = document.getElementById('order-product-name').value.trim();
  var qty = parseInt(document.getElementById('order-qty').value) || 0;
  var requester = document.getElementById('order-requester').value.trim();

  if (!publisher) { showToast('제작사를 입력해주세요.', 'error'); return; }
  if (!name) { showToast('상품명을 입력해주세요.', 'error'); return; }
  if (!qty) { showToast('요청수량을 입력해주세요.', 'error'); return; }

  var orders = getOrderStore();
  orders.unshift({
    date: new Date().toISOString().split('T')[0],
    publisher: publisher,
    name: name,
    qty: qty,
    status: 'requested',
    requester: requester
  });
  localStorage.setItem('gm_orders', JSON.stringify(orders));

  closeModal('order-modal');
  document.getElementById('order-publisher').value = '';
  document.getElementById('order-product-name').value = '';
  document.getElementById('order-qty').value = '';
  document.getElementById('order-requester').value = '';

  showToast('발주가 요청되었습니다.', 'success');
  loadInventory();
}

function updateOrderStatus(idx, newStatus) {
  var orders = getOrderStore();
  if (orders[idx]) {
    orders[idx].status = newStatus;
    localStorage.setItem('gm_orders', JSON.stringify(orders));
    showToast('상태가 변경되었습니다.', 'success');
    renderOrders();
  }
}

function deleteOrder(idx) {
  if (!confirm('이 발주 요청을 삭제하시겠습니까?')) return;
  var orders = getOrderStore();
  orders.splice(idx, 1);
  localStorage.setItem('gm_orders', JSON.stringify(orders));
  showToast('발주 요청이 삭제되었습니다.', 'success');
  renderOrders();
}

function checkLowStock() {
  var items = getInventoryStore();
  var lowItems = items.filter(function(item) {
    return item.currentStock < item.minStock;
  });
  if (lowItems.length > 0) {
    // Silent check - could show a notification badge if desired
  }
}

// ============================================
// Payslip (급여명세서)
// ============================================

// 4대보험 공제 계산 (간이)
function calculateDeductions(grossPay, type) {
  if (type === 'parttime' || grossPay < 500000) {
    // 알바/PT는 3.3% 원천징수
    return Math.round(grossPay * 0.033);
  }
  // 정규직 4대보험 근사치
  // 국민연금 4.5% + 건강보험 3.545% + 장기요양 0.4541% + 고용보험 0.9% = ~9.4%
  return Math.round(grossPay * 0.094);
}

function loadPayslips() {
  // Fill month selector (recent 6 months)
  const select = document.getElementById('payslip-month');
  if (!select) return;
  select.innerHTML = '';
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i);
    const val = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    const label = d.getFullYear() + '년 ' + (d.getMonth()+1) + '월';
    select.innerHTML += `<option value="${val}">${label}</option>`;
  }
  select.onchange = renderPayslips;
  renderPayslips();
}

function renderPayslips() {
  const hrData = JSON.parse(localStorage.getItem('gm_hr_data') || '{}');
  const tbody = document.getElementById('payslip-table');
  if (!tbody) return;

  // Get all profiles (from what we can access)
  // Use HR data merged with known staff
  const staffList = Object.entries(hrData).map(([id, data]) => ({
    id, ...data
  }));

  // If no HR data, show message
  if (staffList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">인사관리에서 직원 정보를 먼저 등록하세요.</td></tr>';
    return;
  }

  let totalGross = 0, totalDeduct = 0, totalNet = 0;

  tbody.innerHTML = staffList.map(staff => {
    const payType = staff.payType || 'monthly';
    const payAmount = parseInt(staff.payAmount) || 0;
    const contractType = staff.contractType || 'regular';

    let grossPay = payAmount;
    if (payType === 'hourly') {
      // Estimate monthly: hourly x 209 hours (standard)
      grossPay = payAmount * 209;
    }

    const deductions = calculateDeductions(grossPay, contractType);
    const netPay = grossPay - deductions;

    totalGross += grossPay;
    totalDeduct += deductions;
    totalNet += netPay;

    return `<tr>
      <td style="font-weight:600;">${staff.name || '-'}</td>
      <td>${staff.department || '-'}</td>
      <td><span class="badge ${contractType === 'parttime' ? 'badge-pending' : 'badge-approved'}">${contractType === 'regular' ? '정규직' : contractType === 'contract' ? '계약직' : '알바'}</span></td>
      <td>₩${grossPay.toLocaleString()}</td>
      <td style="color:var(--red);">-₩${deductions.toLocaleString()}</td>
      <td style="font-weight:700;">₩${netPay.toLocaleString()}</td>
      <td><button class="btn btn-sm btn-secondary" onclick="downloadPayslip('${staff.id}')">다운로드</button></td>
    </tr>`;
  }).join('');

  document.getElementById('payslip-total-gross').textContent = '₩' + totalGross.toLocaleString();
  document.getElementById('payslip-total-deduct').textContent = '-₩' + totalDeduct.toLocaleString();
  document.getElementById('payslip-total-net').textContent = '₩' + totalNet.toLocaleString();
}

function downloadPayslip(staffId) {
  const hrData = JSON.parse(localStorage.getItem('gm_hr_data') || '{}');
  const staff = hrData[staffId];
  if (!staff) return;

  const month = document.getElementById('payslip-month')?.value || '';
  const monthLabel = month.replace('-', '년 ') + '월';

  const payAmount = parseInt(staff.payAmount) || 0;
  const payType = staff.payType || 'monthly';
  const contractType = staff.contractType || 'regular';
  let grossPay = payType === 'hourly' ? payAmount * 209 : payAmount;
  const deductions = calculateDeductions(grossPay, contractType);
  const netPay = grossPay - deductions;

  // Insurance breakdown (approximate)
  const pension = Math.round(grossPay * 0.045);
  const health = Math.round(grossPay * 0.03545);
  const longcare = Math.round(grossPay * 0.004541);
  const employ = Math.round(grossPay * 0.009);

  const wb = XLSX.utils.book_new();
  const data = [
    ['급 여 명 세 서'],
    [],
    ['회사명', '', '주식회사 굿즈모먼트'],
    ['정산월', '', monthLabel],
    [],
    ['성명', '', staff.name || '-'],
    ['부서', '', staff.department || '-'],
    ['직급', '', staff.position || '-'],
    ['계약형태', '', contractType === 'regular' ? '정규직' : contractType === 'contract' ? '계약직' : '알바'],
    [],
    ['[지급내역]'],
    ['기본급', '', grossPay],
    [],
    ['[공제내역]'],
  ];

  if (contractType === 'parttime') {
    data.push(['원천징수 (3.3%)', '', deductions]);
  } else {
    data.push(['국민연금 (4.5%)', '', pension]);
    data.push(['건강보험 (3.545%)', '', health]);
    data.push(['장기요양 (0.454%)', '', longcare]);
    data.push(['고용보험 (0.9%)', '', employ]);
    data.push(['공제 합계', '', deductions]);
  }

  data.push([]);
  data.push(['세전 급여', '', grossPay]);
  data.push(['공제 합계', '', deductions]);
  data.push(['세후 지급액', '', netPay]);

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:18},{wch:4},{wch:18}];
  XLSX.utils.book_append_sheet(wb, ws, '급여명세서');

  XLSX.writeFile(wb, `${staff.name}_${monthLabel}_급여명세서.xlsx`);
  showToast(`${staff.name} 급여명세서 다운로드 완료`, 'success');
}

function generateAllPayslips() {
  const hrData = JSON.parse(localStorage.getItem('gm_hr_data') || '{}');
  Object.keys(hrData).forEach((id, i) => {
    setTimeout(() => downloadPayslip(id), i * 300);
  });
}

// ============================================
// Project Cost Tracking (비용 관리)
// ============================================

function addProjectCost(projectId) {
  const itemEl = document.getElementById('cost-item-' + projectId);
  const descEl = document.getElementById('cost-desc-' + projectId);
  const amountEl = document.getElementById('cost-amount-' + projectId);
  if (!itemEl || !amountEl) return;

  const item = itemEl.value.trim();
  const desc = descEl ? descEl.value.trim() : '';
  const amount = parseInt(amountEl.value) || 0;

  if (!item || !amount) {
    showToast('항목과 금액을 입력하세요.', 'error');
    return;
  }

  const projects = getProjectStore();
  const proj = projects.find(p => p.id === projectId);
  if (!proj) return;

  if (!proj.costs) proj.costs = [];
  proj.costs.push({ item, desc, amount });
  setProjectStore(projects);

  itemEl.value = '';
  if (descEl) descEl.value = '';
  amountEl.value = '';

  renderProjectCosts(projectId);
  showToast('비용이 추가되었습니다.', 'success');
}

function deleteProjectCost(projectId, index) {
  if (!confirm('이 비용 항목을 삭제하시겠습니까?')) return;
  const projects = getProjectStore();
  const proj = projects.find(p => p.id === projectId);
  if (!proj || !proj.costs) return;

  proj.costs.splice(index, 1);
  setProjectStore(projects);
  renderProjectCosts(projectId);
  showToast('비용이 삭제되었습니다.', 'success');
}

function renderProjectCosts(projectId) {
  const projects = getProjectStore();
  const proj = projects.find(p => p.id === projectId);
  if (!proj) return;

  const costs = proj.costs || [];
  const tbody = document.getElementById('project-costs-' + projectId);
  if (!tbody) return;

  let totalCost = 0;

  if (costs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">등록된 비용이 없습니다.</td></tr>';
  } else {
    tbody.innerHTML = costs.map((c, i) => {
      totalCost += (c.amount || 0);
      return `<tr>
        <td style="font-weight:600;">${c.item}</td>
        <td>${c.desc || '-'}</td>
        <td>₩${(c.amount || 0).toLocaleString()}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="deleteProjectCost('${projectId}', ${i})" style="color:var(--red); font-size:12px;">삭제</button></td>
      </tr>`;
    }).join('');
  }

  // Recalculate totalCost from scratch for footer
  totalCost = costs.reduce((sum, c) => sum + (c.amount || 0), 0);
  const laborCost = calculateProjectCost(proj);
  const revenue = proj.actualRevenue || 0;
  const profit = revenue - totalCost - laborCost;

  const totalEl = document.getElementById('project-cost-total-' + projectId);
  const profitEl = document.getElementById('project-profit-' + projectId);
  if (totalEl) totalEl.textContent = '₩' + totalCost.toLocaleString();
  if (profitEl) {
    profitEl.textContent = '₩' + profit.toLocaleString();
    profitEl.style.color = profit >= 0 ? 'var(--primary)' : 'var(--red)';
  }
}

// ============================================
// CLIENTS (거래처 관리)
// ============================================

function getClientStore() {
  try { return JSON.parse(localStorage.getItem('gm_clients')) || []; }
  catch { return []; }
}

function setClientStore(data) {
  localStorage.setItem('gm_clients', JSON.stringify(data));
}

// Default client data (pre-populated from known publishers)
function getDefaultClients() {
  return [
    { id: 'cl_1', name: '(주)다온크리에이티브', bizNo: '', bank: '', contractDate: '', contractPeriod: '', status: '계약완료', feeRate: '25%', feeBasis: '부가세수수료제외', dataDate: '익월10일', payDate: '익월말일', contactName: '홍성일 파트장', contactEmail: 'sungil1102@daoncreative.com', contactPhone: '', taxEmail: '', orderEmail: '', memo: '' },
    { id: 'cl_2', name: '주식회사 제이비케이콘텐츠', bizNo: '', bank: '', contractDate: '', contractPeriod: '', status: '계약완료', feeRate: '25%', feeBasis: '부가세수수료제외', dataDate: '익월7일', payDate: '정산후2주', contactName: '안병하 부장', contactEmail: 'ahn@jbkcorp.kr', contactPhone: '', taxEmail: '', orderEmail: '', memo: '' },
    { id: 'cl_3', name: '(주)재담미디어', bizNo: '105-87-84058', bank: '', contractDate: '', contractPeriod: '', status: '계약완료', feeRate: '25%', feeBasis: '부가세수수료제외', dataDate: '익월7일', payDate: '익월15일', contactName: '이문수 PD', contactEmail: 'sio@jaedam.com', contactPhone: '', taxEmail: '', orderEmail: '', memo: '' },
    { id: 'cl_4', name: '주식회사 두세븐엔터테인먼트', bizNo: '332-86-02331', bank: '', contractDate: '', contractPeriod: '', status: '계약완료', feeRate: '28%', feeBasis: '부가세수수료포함', dataDate: '익월10일', payDate: '익월말일', contactName: '전민희 차장', contactEmail: 'jeon@do7ent.com', contactPhone: '', taxEmail: '', orderEmail: '', memo: '' },
    { id: 'cl_5', name: '씨엔씨레볼루션(주)', bizNo: '220-86-24783', bank: '', contractDate: '', contractPeriod: '', status: '계약완료', feeRate: '25%', feeBasis: '부가세수수료제외', dataDate: '익월7일', payDate: '익월말일', contactName: '황은해 팀장', contactEmail: 'hwang@cncrevolution.kr', contactPhone: '', taxEmail: '', orderEmail: '', memo: '' },
    { id: 'cl_6', name: '콘텐츠퍼스트 주식회사', bizNo: '113-86-67000', bank: '', contractDate: '', contractPeriod: '', status: '계약완료', feeRate: '25% (웻샌드20%)', feeBasis: '부가세수수료제외', dataDate: '익월10일', payDate: '익월말일', contactName: '황혜조 매니저', contactEmail: 'mickey@tappytoon.com', contactPhone: '', taxEmail: '', orderEmail: '', memo: '' },
    { id: 'cl_7', name: '코드엠아이엔씨(주)', bizNo: '333-81-00743', bank: '', contractDate: '', contractPeriod: '', status: '계약완료', feeRate: '30%', feeBasis: '부가세수수료포함', dataDate: '익월5일', payDate: '익월말일', contactName: '이하늘 팀장', contactEmail: 'haneul@bifrostkr.com', contactPhone: '', taxEmail: '', orderEmail: '', memo: '' },
    { id: 'cl_8', name: '주식회사 북극여우', bizNo: '384-81-01468', bank: '', contractDate: '', contractPeriod: '', status: '계약완료', feeRate: '25%', feeBasis: '부가세수수료제외', dataDate: '익월10일', payDate: '익월말일', contactName: '박세민', contactEmail: 'psmin@polarfoxbook.com', contactPhone: '', taxEmail: '', orderEmail: '', memo: '' },
    { id: 'cl_9', name: '디씨씨이엔티 주식회사', bizNo: '119-87-06686', bank: '', contractDate: '', contractPeriod: '', status: '계약완료', feeRate: '25%', feeBasis: '부가세수수료제외', dataDate: '익월7일', payDate: '익월15일', contactName: '양희지 매니저', contactEmail: 'yangzi35@dcckor.com', contactPhone: '', taxEmail: '', orderEmail: '', memo: '' },
    { id: 'cl_10', name: '주식회사 블루픽', bizNo: '205-88-03575', bank: '', contractDate: '', contractPeriod: '', status: '계약완료', feeRate: '25%', feeBasis: '수수료제외', dataDate: '익월15일', payDate: '익월말일', contactName: '이수빈 과장', contactEmail: 'book01@imageframe.kr', contactPhone: '', taxEmail: '', orderEmail: '', memo: '' },
    { id: 'cl_11', name: '도서출판 청어람', bizNo: '130-90-37449', bank: '', contractDate: '', contractPeriod: '', status: '계약완료', feeRate: '25%', feeBasis: '부가세수수료제외', dataDate: '익월10일', payDate: '익월말일', contactName: '박문수 실장', contactEmail: 'nadapms@naver.com', contactPhone: '010-7711-8012', taxEmail: '', orderEmail: '', memo: '공급율 65% 정산' },
    { id: 'cl_12', name: '(주)학산문화사', bizNo: '106-81-54690', bank: '', contractDate: '', contractPeriod: '', status: '계약완료', feeRate: '25%', feeBasis: '부가세수수료제외', dataDate: '익월7일', payDate: '익월말일', contactName: '', contactEmail: '', contactPhone: '', taxEmail: '', orderEmail: '', memo: '' },
    { id: 'cl_13', name: '투유드림', bizNo: '209-81-59897', bank: '', contractDate: '', contractPeriod: '', status: '계약완료', feeRate: '25%', feeBasis: '부가세수수료제외', dataDate: '', payDate: '', contactName: '', contactEmail: '', contactPhone: '', taxEmail: '', orderEmail: '', memo: '' },
    { id: 'cl_14', name: '리디 주식회사', bizNo: '120-87-27435', bank: '', contractDate: '', contractPeriod: '', status: '계약완료', feeRate: '25% (VAT포함)', feeBasis: '부가세수수료포함', dataDate: '익월5일', payDate: '계산서 발행 후 20일', contactName: '최가은 매니저', contactEmail: 'lead.gaeun.choi@ridi.com', contactPhone: '', taxEmail: '', orderEmail: '', memo: '국내 판매 한정' },
    { id: 'cl_15', name: '와이랩', bizNo: '', bank: '', contractDate: '', contractPeriod: '', status: '계약완료', feeRate: '25%', feeBasis: '부가세수수료제외', dataDate: '', payDate: '', contactName: '', contactEmail: '', contactPhone: '', taxEmail: '', orderEmail: '', memo: '' },
    { id: 'cl_16', name: '락킨코리아', bizNo: '', bank: '', contractDate: '', contractPeriod: '', status: '계약완료', feeRate: '25%', feeBasis: '부가세수수료제외', dataDate: '', payDate: '', contactName: '', contactEmail: '', contactPhone: '', taxEmail: '', orderEmail: '', memo: '' },
    { id: 'cl_17', name: '네이버웹툰 유한회사', bizNo: '669-86-01888', bank: '', contractDate: '', contractPeriod: '', status: '계약완료', feeRate: '25% (VAT포함)', feeBasis: '부가세수수료포함', dataDate: '익월5일', payDate: '익월말일', contactName: '최은원', contactEmail: 'eunwon.choi@webtoonscorp.com', contactPhone: '010-6206-7082', taxEmail: '', orderEmail: '', memo: '3개월 단위 자동연장, 매월 25일까지 발주서 이메일' },
    { id: 'cl_18', name: '주식회사 에이템포미디어', bizNo: '752-86-01268', bank: '', contractDate: '', contractPeriod: '', status: '계약완료', feeRate: '25%', feeBasis: '부가세수수료제외', dataDate: '', payDate: '', contactName: '', contactEmail: '', contactPhone: '', taxEmail: '', orderEmail: '', memo: '' },
    { id: 'cl_19', name: '태양네트웍스', bizNo: '', bank: '', contractDate: '', contractPeriod: '', status: '협의중', feeRate: '27% (VAT포함)', feeBasis: '부가세수수료포함', dataDate: '익월5일', payDate: '익월말일', contactName: '', contactEmail: '', contactPhone: '', taxEmail: '', orderEmail: '', memo: '' },
    { id: 'cl_20', name: '맥 에이전시', bizNo: '', bank: '', contractDate: '', contractPeriod: '', status: '협의중', feeRate: '', feeBasis: '', dataDate: '', payDate: '', contactName: '', contactEmail: '', contactPhone: '', taxEmail: '', orderEmail: '', memo: '' },
    { id: 'cl_21', name: '투니크', bizNo: '', bank: '', contractDate: '', contractPeriod: '', status: '협의중', feeRate: '', feeBasis: '', dataDate: '', payDate: '', contactName: '', contactEmail: '', contactPhone: '', taxEmail: '', orderEmail: '', memo: '' },
    { id: 'cl_22', name: '바이프로스트', bizNo: '', bank: '', contractDate: '', contractPeriod: '', status: '계약완료', feeRate: '30%', feeBasis: '부가세수수료포함', dataDate: '익월5일', payDate: '익월말일', contactName: '이하늘 팀장', contactEmail: 'haneul@bifrostkr.com', contactPhone: '010-6762-7110', taxEmail: '', orderEmail: '', memo: '코드엠 계약법인, 입고확인서 3일이내' },
    { id: 'cl_23', name: '북새통', bizNo: '', bank: '', contractDate: '', contractPeriod: '', status: '협의중', feeRate: '', feeBasis: '', dataDate: '', payDate: '', contactName: '박회탁 대표', contactEmail: '', contactPhone: '', taxEmail: '', orderEmail: '', memo: '' }
  ];
}

function loadClients() {
  let clients = getClientStore();
  if (clients.length === 0) {
    clients = getDefaultClients();
    setClientStore(clients);
  }
  renderClientList();
}

function switchClientTab(tab, btnEl) {
  // Hide all tabs
  document.getElementById('clients-tab-list').style.display = 'none';
  document.getElementById('clients-tab-contract').style.display = 'none';

  // Show selected tab
  document.getElementById('clients-tab-' + tab).style.display = 'block';

  // Update tab buttons
  document.querySelectorAll('.client-tab-btn').forEach(b => {
    b.style.background = '';
    b.style.color = '';
  });
  if (btnEl) {
    btnEl.style.background = 'var(--primary)';
    btnEl.style.color = 'white';
  }

  // Render content
  if (tab === 'list') renderClientList();
  else if (tab === 'contract') renderContractStatus();
}

function renderClientList() {
  const clients = getClientStore();
  const tbody = document.getElementById('client-list');
  if (!tbody) return;

  if (clients.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">등록된 거래처가 없습니다.</td></tr>';
    return;
  }

  const statusBadge = (s) => {
    const colors = { '계약완료': 'working', '협의중': '', '대기': 'off', '종료': '' };
    const cls = colors[s] || '';
    if (s === '협의중') return `<span class="status-badge" style="background:var(--yellow-bg); color:#B8860B;">${s}</span>`;
    if (s === '종료') return `<span class="status-badge" style="background:var(--gray-100); color:var(--gray-500);">${s}</span>`;
    return `<span class="status-badge ${cls}">${s}</span>`;
  };

  tbody.innerHTML = clients.map((c, i) => `<tr style="cursor:pointer;" onclick="openClientModal(${i})">
    <td style="font-weight:600;">${c.name}</td>
    <td>${c.bizNo || '-'}</td>
    <td>${statusBadge(c.status)}</td>
    <td>${c.feeRate || '-'}</td>
    <td style="font-size:12px;">${c.dataDate || '-'} / ${c.payDate || '-'}</td>
    <td>${c.contactName || '-'}</td>
    <td style="font-size:12px;">${c.contactEmail || '-'}</td>
    <td>${c.contactPhone || '-'}</td>
    <td style="font-size:12px; color:var(--gray-500);">${c.memo || '-'}</td>
  </tr>`).join('');
}

function renderContractStatus() {
  const clients = getClientStore();
  const tbody = document.getElementById('contract-status-list');
  if (!tbody) return;

  // Update stats
  const el = (id) => document.getElementById(id);
  if (el('stat-total-clients')) el('stat-total-clients').textContent = clients.length;
  if (el('stat-contracted-clients')) el('stat-contracted-clients').textContent = clients.filter(c => c.status === '계약완료').length;
  if (el('stat-negotiating-clients')) el('stat-negotiating-clients').textContent = clients.filter(c => c.status === '협의중').length;

  if (clients.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">등록된 계약이 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = clients.map(c => `<tr>
    <td style="font-weight:600;">${c.name}</td>
    <td>${c.contractDate || '-'}</td>
    <td>${c.contractPeriod || '-'}</td>
    <td>${c.feeRate || '-'} (${c.feeBasis || '-'})</td>
    <td>${c.dataDate || '-'}</td>
    <td>${c.payDate || '-'}</td>
    <td style="font-size:12px; color:var(--gray-500);">${c.memo || '-'}</td>
  </tr>`).join('');
}

function openClientModal(index) {
  const modal = document.getElementById('client-modal');
  const titleEl = document.getElementById('client-modal-title');
  const editIdx = document.getElementById('client-edit-index');
  const deleteBtn = document.getElementById('client-delete-btn');

  // Reset fields
  document.getElementById('client-name').value = '';
  document.getElementById('client-bizno').value = '';
  document.getElementById('client-bank').value = '';
  document.getElementById('client-contract-date').value = '';
  document.getElementById('client-contract-period').value = '';
  document.getElementById('client-status').value = '계약완료';
  document.getElementById('client-fee-rate').value = '';
  document.getElementById('client-fee-basis').value = '부가세수수료제외';
  document.getElementById('client-data-date').value = '';
  document.getElementById('client-pay-date').value = '';
  document.getElementById('client-contact-name').value = '';
  document.getElementById('client-contact-email').value = '';
  document.getElementById('client-contact-phone').value = '';
  document.getElementById('client-tax-email').value = '';
  document.getElementById('client-order-email').value = '';
  document.getElementById('client-memo').value = '';

  if (typeof index === 'number') {
    // Edit mode
    const clients = getClientStore();
    const c = clients[index];
    if (!c) return;

    titleEl.textContent = '거래처 수정';
    editIdx.value = index;
    deleteBtn.style.display = 'inline-flex';

    document.getElementById('client-name').value = c.name || '';
    document.getElementById('client-bizno').value = c.bizNo || '';
    document.getElementById('client-bank').value = c.bank || '';
    document.getElementById('client-contract-date').value = c.contractDate || '';
    document.getElementById('client-contract-period').value = c.contractPeriod || '';
    document.getElementById('client-status').value = c.status || '계약완료';
    document.getElementById('client-fee-rate').value = c.feeRate || '';
    document.getElementById('client-fee-basis').value = c.feeBasis || '부가세수수료제외';
    document.getElementById('client-data-date').value = c.dataDate || '';
    document.getElementById('client-pay-date').value = c.payDate || '';
    document.getElementById('client-contact-name').value = c.contactName || '';
    document.getElementById('client-contact-email').value = c.contactEmail || '';
    document.getElementById('client-contact-phone').value = c.contactPhone || '';
    document.getElementById('client-tax-email').value = c.taxEmail || '';
    document.getElementById('client-order-email').value = c.orderEmail || '';
    document.getElementById('client-memo').value = c.memo || '';
  } else {
    titleEl.textContent = '거래처 추가';
    editIdx.value = '';
    deleteBtn.style.display = 'none';
  }

  modal.classList.add('active');
}

function saveClient() {
  const name = document.getElementById('client-name').value.trim();
  if (!name) { showToast('제작사명을 입력해주세요.', 'error'); return; }

  const client = {
    name: name,
    bizNo: document.getElementById('client-bizno').value.trim(),
    bank: document.getElementById('client-bank').value.trim(),
    contractDate: document.getElementById('client-contract-date').value,
    contractPeriod: document.getElementById('client-contract-period').value.trim(),
    status: document.getElementById('client-status').value,
    feeRate: document.getElementById('client-fee-rate').value.trim(),
    feeBasis: document.getElementById('client-fee-basis').value,
    dataDate: document.getElementById('client-data-date').value.trim(),
    payDate: document.getElementById('client-pay-date').value.trim(),
    contactName: document.getElementById('client-contact-name').value.trim(),
    contactEmail: document.getElementById('client-contact-email').value.trim(),
    contactPhone: document.getElementById('client-contact-phone').value.trim(),
    taxEmail: document.getElementById('client-tax-email').value.trim(),
    orderEmail: document.getElementById('client-order-email').value.trim(),
    memo: document.getElementById('client-memo').value.trim()
  };

  const clients = getClientStore();
  const editIdx = document.getElementById('client-edit-index').value;

  if (editIdx !== '') {
    // Update existing
    const idx = parseInt(editIdx);
    client.id = clients[idx].id;
    clients[idx] = client;
    showToast('거래처가 수정되었습니다.', 'success');
  } else {
    // Add new
    client.id = 'cl_' + Date.now();
    clients.push(client);
    showToast('거래처가 추가되었습니다.', 'success');
  }

  setClientStore(clients);
  closeModal('client-modal');
  renderClientList();
}

function deleteClient() {
  const editIdx = document.getElementById('client-edit-index').value;
  if (editIdx === '') return;

  if (!confirm('이 거래처를 삭제하시겠습니까?')) return;

  const clients = getClientStore();
  clients.splice(parseInt(editIdx), 1);
  setClientStore(clients);

  closeModal('client-modal');
  renderClientList();
  showToast('거래처가 삭제되었습니다.', 'success');
}

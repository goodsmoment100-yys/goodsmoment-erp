// ============================================
// SETTLEMENT ENGINE - 이지포스 정산 자동화
// ============================================

// SheetJS CDN is loaded in dashboard.html

// ---- 제작사별 요율 & 정보 ----
const PUBLISHERS = {
  '다온크리에이티브': { rate: 0.25, type: 'net', email: 'sungil1102@daoncreative.com', taxEmail: 'sungil1102@daoncreative.com' },
  '제이비케이콘텐츠': { rate: 0.25, type: 'net', email: 'ahn@jbkcorp.kr', taxEmail: 'ahn@jbkcorp.kr' },
  '재담미디어': { rate: 0.25, type: 'net', email: 'sio@jaedam.com', taxEmail: 'merit@jaedam.com' },
  '두세븐엔터테인먼트': { rate: 0.28, type: 'gross', email: 'jeon@do7ent.com', taxEmail: 'jeon@do7ent.com' },
  '씨엔씨레볼루션': { rate: 0.25, type: 'net', email: 'hwang@cncrevolution.kr', taxEmail: 'syyoon@cncrevolution.kr' },
  '콘텐츠퍼스트': { rate: 0.25, type: 'net', email: 'mickey@tappytoon.com', taxEmail: 'mickey@tappytoon.com', exceptions: { '웻샌드': 0.20 } },
  '코드엠아이엔씨': { rate: 0.30, type: 'gross', email: 'haneul@bifrostkr.com', taxEmail: 'anji@codem.kr' },
  '바이프로스트': { rate: 0.30, type: 'gross', email: 'haneul@bifrostkr.com', taxEmail: 'anji@codem.kr' },
  '북극여우': { rate: 0.25, type: 'net', email: 'psmin@polarfoxbook.com', taxEmail: 'tax@polarfoxbook.com' },
  '디씨씨이엔티': { rate: 0.25, type: 'net', email: 'yangzi35@dcckor.com', taxEmail: 'yangzi35@dcckor.com' },
  '청어람': { rate: 0.25, type: 'net', email: 'nadapms@naver.com', taxEmail: 'nadapms@naver.com' },
  '블루픽': { rate: 0.25, type: 'net_no_vat', email: 'book01@imageframe.kr', taxEmail: 'book01@imageframe.kr' },
};

// ---- 이지포스 소분류 → 제작사 매핑 ----
// 상품명 접두사 [XX] 또는 소분류명으로 매칭
const PUBLISHER_ALIASES = {
  '작두': '작두',
  '킬러배드로': '킬러배드로',
  '킬배': '킬러배드로',
  '마루는강쥐': '마루는강쥐',
  '마루': '마루는강쥐',
  '세레나': '세레나',
  '북극여우': '북극여우',
  '꿈이상': '북극여우',
  '꿈자리': '북극여우',
  '무림손녀': '북극여우',
  '별과별사이': '북극여우',
  '사랑소년': '북극여우',
  '세나개': '북극여우',
  '스파베': '북극여우',
  '하절기': '북극여우',
  '향막': '북극여우',
  '홀리필름': '북극여우',
  '검후': '북극여우',
  '너드': '북극여우',
};

// 파싱된 데이터 저장
let parsedData = null;
let settlementResults = null;

// ---- 드래그앤드롭 설정 ----
document.addEventListener('DOMContentLoaded', () => {
  const dropzone = document.getElementById('settle-dropzone');
  if (!dropzone) return;

  dropzone.addEventListener('click', () => {
    document.getElementById('settle-file-input').click();
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--primary)';
    dropzone.style.background = 'rgba(46, 196, 182, 0.05)';
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.style.borderColor = 'var(--gray-300)';
    dropzone.style.background = '';
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--gray-300)';
    dropzone.style.background = '';
    if (e.dataTransfer.files.length) {
      handleSettleFile(e.dataTransfer.files[0]);
    }
  });

  // 기본 정산 월 설정 (지난 달)
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1);
  const monthInput = document.getElementById('settle-month');
  if (monthInput) {
    monthInput.value = lastMonth.getFullYear() + '-' + String(lastMonth.getMonth() + 1).padStart(2, '0');
  }
});

// ---- 엑셀 파일 처리 ----
function handleSettleFile(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });

      // 첫 번째 시트 읽기
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

      parsedData = parseEasyPOSData(jsonData);

      // UI 업데이트
      document.getElementById('settle-file-info').style.display = 'block';
      document.getElementById('settle-file-name').textContent = file.name + ' — ' + parsedData.length + '개 상품';
      document.getElementById('settle-step2').style.display = 'block';
      document.getElementById('settle-dropzone').style.borderColor = 'var(--green)';

      showToast(file.name + ' 로드 완료! ' + parsedData.length + '개 상품 감지', 'success');
    } catch (err) {
      showToast('파일 읽기 실패: ' + err.message, 'error');
      console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
}

// ---- 이지포스 데이터 파싱 ----
function parseEasyPOSData(rows) {
  const items = [];
  let headerRow = -1;

  // 헤더 행 찾기
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i];
    const rowStr = row.join(',');
    if (rowStr.includes('상품명') || rowStr.includes('NO')) {
      headerRow = i;
      break;
    }
  }

  if (headerRow === -1) {
    showToast('이지포스 엑셀 형식을 인식할 수 없습니다.', 'error');
    return [];
  }

  const headers = rows[headerRow];

  // 컬럼 인덱스 찾기
  let colMap = {};
  headers.forEach((h, idx) => {
    const hs = String(h).replace(/\n/g, '').trim();
    if (hs === 'NO') colMap.no = idx;
    if (hs === '대분류') colMap.cat1 = idx;
    if (hs === '중분류') colMap.cat2 = idx;
    if (hs === '소분류') colMap.cat3 = idx;
    if (hs.includes('상품') && hs.includes('코드')) colMap.code = idx;
    if (hs === '상품명') colMap.name = idx;
    if (hs === '바코드') colMap.barcode = idx;
    if (hs.includes('매출') && hs.includes('수량')) colMap.qty = idx;
    if (hs === '총매출') colMap.totalSales = idx;
    if (hs === '순매출') colMap.netSales = idx;
    if (hs === 'NET매출') colMap.netAmount = idx;
    if (hs === '부가세') colMap.vat = idx;
    if (hs === '판매율') colMap.ratio = idx;
  });

  // 데이터 행 파싱
  let currentCat3 = '';
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    // 합계 행 스킵
    const firstCell = String(row[0] || '').trim();
    if (firstCell === '합계' || firstCell === '') {
      // 소분류가 빈 경우 이전 값 사용
      if (row[colMap.cat3]) currentCat3 = String(row[colMap.cat3]).trim();

      // NO가 없고 합계인 경우 스킵
      if (firstCell === '합계') continue;
      if (!row[colMap.name] && !row[colMap.code]) continue;
    }

    const no = parseNum(row[colMap.no]);
    if (!no && firstCell !== '' && isNaN(parseInt(firstCell))) continue;

    // 소분류 업데이트
    if (row[colMap.cat3] && String(row[colMap.cat3]).trim()) {
      currentCat3 = String(row[colMap.cat3]).trim();
    }

    const productName = String(row[colMap.name] || '').trim();
    if (!productName) continue;

    items.push({
      no: no,
      category1: String(row[colMap.cat1] || '').trim(),
      category2: String(row[colMap.cat2] || '').trim(),
      category3: currentCat3,
      code: String(row[colMap.code] || '').trim(),
      name: productName,
      barcode: String(row[colMap.barcode] || '').trim(),
      qty: parseNum(row[colMap.qty]),
      totalSales: parseNum(row[colMap.totalSales]),
      netSales: parseNum(row[colMap.netSales]),
      netAmount: parseNum(row[colMap.netAmount]),
      vat: parseNum(row[colMap.vat]),
    });
  }

  return items;
}

// ---- 숫자 파싱 (콤마 제거) ----
function parseNum(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return val;
  return parseInt(String(val).replace(/[,₩\s%]/g, '')) || 0;
}

// ---- 제작사 매칭 ----
function matchPublisher(item) {
  // 1. 소분류에서 직접 매칭
  const cat3 = item.category3;
  if (PUBLISHER_ALIASES[cat3]) return PUBLISHER_ALIASES[cat3];

  // 2. 상품명 접두사 [XX]에서 매칭
  const match = item.name.match(/^\[([^\]]+)\]/);
  if (match) {
    const prefix = match[1];
    if (PUBLISHER_ALIASES[prefix]) return PUBLISHER_ALIASES[prefix];
  }

  // 3. 소분류를 그대로 제작사명으로 사용
  return cat3 || '미분류';
}

// ---- 정산 계산 실행 ----
function runSettlement() {
  if (!parsedData || parsedData.length === 0) {
    showToast('먼저 엑셀 파일을 업로드하세요.', 'error');
    return;
  }

  const cardFeeRate = parseFloat(document.getElementById('settle-card-fee').value) / 100;
  const settleMonth = document.getElementById('settle-month').value;

  // 제작사별 집계
  const byPublisher = {};

  parsedData.forEach(item => {
    const publisher = matchPublisher(item);

    if (!byPublisher[publisher]) {
      byPublisher[publisher] = {
        name: publisher,
        items: [],
        totalSales: 0,
        netSales: 0,
        netAmount: 0,
        vat: 0,
        qty: 0,
        cardSales: 0,
        cashSales: 0,
      };
    }

    const pub = byPublisher[publisher];
    pub.items.push(item);
    pub.totalSales += item.totalSales;
    pub.netSales += item.netSales;
    pub.netAmount += item.netAmount;
    pub.vat += item.vat;
    pub.qty += item.qty;

    // 현금/카드가 구분 안 된 경우 전부 카드로 간주 (보수적)
    pub.cardSales += item.totalSales;
  });

  // 요율 적용 & 정산 계산
  const results = [];
  let grandTotal = { totalSales: 0, netSales: 0, cardSales: 0, cashSales: 0, afterFee: 0, publisherShare: 0, gmShare: 0 };

  Object.values(byPublisher).forEach(pub => {
    const config = findPublisherConfig(pub.name);
    const rate = config.rate;
    const rateType = config.type;

    let baseAmount = 0;
    let afterFee = 0;

    if (rateType === 'gross') {
      // 부가세, 수수료 포함 기준 (두세븐, 코드엠)
      baseAmount = pub.totalSales;
      afterFee = baseAmount;
    } else {
      // 부가세 제외 + 카드수수료 차감
      const netAfterVat = pub.netAmount; // 부가세 제외 금액
      const cardFee = pub.cardSales > 0 ? Math.round(netAfterVat * cardFeeRate) : 0;
      afterFee = netAfterVat - cardFee;
      baseAmount = afterFee;
    }

    const gmShare = Math.round(baseAmount * rate);
    const publisherShare = baseAmount - gmShare;

    const result = {
      name: pub.name,
      totalSales: pub.totalSales,
      netSales: pub.netSales,
      netAmount: pub.netAmount,
      vat: pub.vat,
      cardSales: pub.cardSales,
      cashSales: pub.cashSales,
      afterFee: afterFee,
      rate: rate,
      rateType: rateType,
      publisherShare: publisherShare,
      gmShare: gmShare,
      taxAmount: Math.round(publisherShare * 0.1), // 부가세
      totalPayable: publisherShare + Math.round(publisherShare * 0.1), // 공급가 + 부가세
      items: pub.items,
      qty: pub.qty,
      config: config,
      month: settleMonth,
    };

    results.push(result);

    grandTotal.totalSales += pub.totalSales;
    grandTotal.netSales += pub.netSales;
    grandTotal.cardSales += pub.cardSales;
    grandTotal.cashSales += pub.cashSales;
    grandTotal.afterFee += afterFee;
    grandTotal.publisherShare += publisherShare;
    grandTotal.gmShare += gmShare;
  });

  // 결과 정렬 (매출 높은 순)
  results.sort((a, b) => b.totalSales - a.totalSales);
  settlementResults = results;

  // UI 업데이트
  renderSettlementResults(results, grandTotal);
}

// ---- 제작사 설정 찾기 ----
function findPublisherConfig(name) {
  // 정확한 매칭
  if (PUBLISHERS[name]) return PUBLISHERS[name];

  // 부분 매칭
  for (const [key, val] of Object.entries(PUBLISHERS)) {
    if (name.includes(key) || key.includes(name)) return val;
  }

  // 기본값
  return { rate: 0.25, type: 'net', email: '', taxEmail: '' };
}

// ---- 결과 렌더링 ----
function renderSettlementResults(results, grandTotal) {
  // 요약 카드
  document.getElementById('settle-total-sales').textContent = formatMoney(grandTotal.totalSales);
  document.getElementById('settle-card-sales').textContent = formatMoney(grandTotal.cardSales);
  document.getElementById('settle-cash-sales').textContent = formatMoney(grandTotal.cashSales);
  document.getElementById('settle-publisher-count').textContent = results.length + '개사';

  // 테이블
  const tbody = document.getElementById('settle-result-table');
  tbody.innerHTML = results.map(r => `
    <tr>
      <td style="font-weight:600;">${r.name}</td>
      <td>${formatMoney(r.totalSales)}</td>
      <td>${formatMoney(r.netAmount)}</td>
      <td>${formatMoney(r.cardSales)}</td>
      <td>${formatMoney(r.cashSales)}</td>
      <td>${formatMoney(r.afterFee)}</td>
      <td style="color:var(--blue); font-weight:700;">${formatMoney(r.publisherShare)}</td>
      <td style="color:var(--primary); font-weight:700;">${formatMoney(r.gmShare)}</td>
      <td><span class="badge ${r.rateType === 'gross' ? 'badge-pending' : 'badge-approved'}">${Math.round(r.rate * 100)}%</span></td>
      <td><button class="btn btn-sm btn-secondary" onclick="downloadSettlement('${r.name}')">다운로드</button></td>
    </tr>
  `).join('');

  // 합계
  document.getElementById('settle-foot-total').textContent = formatMoney(grandTotal.totalSales);
  document.getElementById('settle-foot-net').textContent = formatMoney(grandTotal.netSales);
  document.getElementById('settle-foot-card').textContent = formatMoney(grandTotal.cardSales);
  document.getElementById('settle-foot-cash').textContent = formatMoney(grandTotal.cashSales);
  document.getElementById('settle-foot-after').textContent = formatMoney(grandTotal.afterFee);
  document.getElementById('settle-foot-publisher').textContent = formatMoney(grandTotal.publisherShare);
  document.getElementById('settle-foot-gm').textContent = formatMoney(grandTotal.gmShare);

  // 결과 표시
  document.getElementById('settle-step3').style.display = 'block';
  document.getElementById('settle-step3').scrollIntoView({ behavior: 'smooth' });

  showToast(results.length + '개 제작사 정산 완료!', 'success');
}

// ---- 금액 포맷 ----
function formatMoney(num) {
  if (!num && num !== 0) return '-';
  return '₩' + num.toLocaleString('ko-KR');
}

// ---- 개별 정산서 다운로드 ----
function downloadSettlement(publisherName) {
  const result = settlementResults.find(r => r.name === publisherName);
  if (!result) return;

  const wb = XLSX.utils.book_new();

  // 시트1: 정산 요약
  const monthStr = result.month ? result.month.replace('-', '년 ') + '월' : '';
  const summary = [
    [monthStr + '  매출정산'],
    [],
    ['운영사', '', '주식회사 굿즈모먼트'],
    ['대 표', '', '육연식'],
    ['사업자번호', '', '250-88-03575'],
    [],
    ['카드총매출액', '', result.cardSales, '', '카드순매출액(부가세 제외)', '', result.netAmount],
    ['PG 정산', '', '카드사 수수료 ' + (parseFloat(document.getElementById('settle-card-fee').value)) + '% 제외', '', (100 - parseFloat(document.getElementById('settle-card-fee').value)) + '%', '', result.afterFee],
    ['현금총매출액', '', result.cashSales, '', '현금순매출액', '', result.cashSales > 0 ? Math.round(result.cashSales / 1.1) : 0],
    [],
  ];

  if (result.rateType === 'gross') {
    summary.push(['위탁판매수수료', '', (100 - Math.round(result.rate * 100)) + '%', result.publisherShare, Math.round(result.rate * 100) + '%', result.gmShare]);
  } else {
    summary.push(['위탁판매수수료', '', (100 - Math.round(result.rate * 100)) + '%', result.publisherShare, Math.round(result.rate * 100) + '%', result.gmShare]);
  }

  summary.push(
    ['세금계산서\n내역', '공급가액', result.publisherShare, '', result.gmShare],
    ['', '부가세', result.taxAmount],
    ['', '합계금액', result.totalPayable],
  );

  const ws1 = XLSX.utils.aoa_to_sheet(summary);
  // 열 너비 설정
  ws1['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 22 }, { wch: 10 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws1, '정산요약');

  // 시트2: 상품 상세
  const detailHeader = ['거래처', 'IP', '상품명', '바코드', '수량', '총매출', '순매출', 'NET매출', '부가세'];
  const detailRows = result.items.map(item => [
    result.name,
    item.category3,
    item.name,
    item.barcode,
    item.qty,
    item.totalSales,
    item.netSales,
    item.netAmount,
    item.vat,
  ]);

  // 합계 행
  detailRows.push([
    '합 계', '', '', '',
    result.qty,
    result.totalSales,
    result.netSales,
    result.netAmount,
    result.vat,
  ]);

  const ws2 = XLSX.utils.aoa_to_sheet([detailHeader, ...detailRows]);
  ws2['!cols'] = [{ wch: 14 }, { wch: 20 }, { wch: 30 }, { wch: 16 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws2, '상품상세');

  // 다운로드
  const fileName = `${result.name}_${monthStr}_정산서.xlsx`;
  XLSX.writeFile(wb, fileName);
  showToast(fileName + ' 다운로드 완료', 'success');
}

// ---- 전체 정산서 일괄 다운로드 ----
function downloadAllSettlements() {
  if (!settlementResults || settlementResults.length === 0) {
    showToast('정산 결과가 없습니다.', 'error');
    return;
  }

  settlementResults.forEach(result => {
    setTimeout(() => downloadSettlement(result.name), 300);
  });
}

// ============================================
// URBAN PLAY SETTLEMENT (어반플레이 정산)
// ============================================

// ---- 탭 전환 ----
function switchSettleTab(tab) {
  const publisherTab = document.getElementById('settle-tab-publisher');
  const urbanTab = document.getElementById('settle-tab-urban');
  const publisherBtn = document.getElementById('settle-tab-btn-publisher');
  const urbanBtn = document.getElementById('settle-tab-btn-urban');

  if (tab === 'publisher') {
    if (publisherTab) publisherTab.style.display = 'block';
    if (urbanTab) urbanTab.style.display = 'none';
    if (publisherBtn) { publisherBtn.style.borderBottomColor = 'var(--primary)'; publisherBtn.style.color = 'var(--primary)'; }
    if (urbanBtn) { urbanBtn.style.borderBottomColor = 'transparent'; urbanBtn.style.color = 'var(--gray-500)'; }
  } else {
    if (publisherTab) publisherTab.style.display = 'none';
    if (urbanTab) urbanTab.style.display = 'block';
    if (publisherBtn) { publisherBtn.style.borderBottomColor = 'transparent'; publisherBtn.style.color = 'var(--gray-500)'; }
    if (urbanBtn) { urbanBtn.style.borderBottomColor = 'var(--primary)'; urbanBtn.style.color = 'var(--primary)'; }

    // Set default month
    const monthInput = document.getElementById('urban-settle-month');
    if (monthInput && !monthInput.value) {
      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1);
      monthInput.value = lastMonth.getFullYear() + '-' + String(lastMonth.getMonth() + 1).padStart(2, '0');
    }
  }
}

// ---- 어반플레이 정산 계산 ----
function calculateUrbanSettlement() {
  const storeSales = parseInt(document.getElementById('urban-store-sales').value) || 0;
  const gachaSales = parseInt(document.getElementById('urban-gacha-sales').value) || 0;
  const laborCost = parseInt(document.getElementById('urban-labor-cost').value) || 0;
  const suppliesCost = parseInt(document.getElementById('urban-supplies-cost').value) || 0;
  const mgmtCost = parseInt(document.getElementById('urban-mgmt-cost').value) || 0;

  // 가챠 수수료 22%
  const gachaCommission = Math.round(gachaSales * 0.22);

  // 매출 합계
  const totalRevenue = storeSales + gachaCommission;

  // 비용 합계
  const totalCost = laborCost + suppliesCost + mgmtCost;

  // 비용보전 (어반플레이가 비용의 50% 부담)
  const costShare = Math.round(totalCost * 0.5);

  // 순익 = 매출 - 비용 + 비용보전
  const netProfit = totalRevenue - totalCost + costShare;

  // 50/50 분배
  const urbanShare = Math.round(netProfit * 0.5);
  const gmShare = netProfit - urbanShare;

  // 3층 임대료 (고정)
  const rent = 2500000;

  // 총 지급액 = 어반플레이몫 + 3층 임대료 + 관리비 (VAT 포함)
  const subtotal = urbanShare + rent + mgmtCost;
  const totalPayment = Math.round(subtotal * 1.1); // VAT 10% 포함

  // UI 업데이트
  const fmt = (n) => '₩' + n.toLocaleString('ko-KR');

  const el = (id) => document.getElementById(id);
  if (el('urban-total-revenue')) el('urban-total-revenue').textContent = fmt(totalRevenue);
  if (el('urban-total-cost')) el('urban-total-cost').textContent = fmt(totalCost);
  if (el('urban-cost-share')) el('urban-cost-share').textContent = fmt(costShare);
  if (el('urban-net-profit')) el('urban-net-profit').textContent = fmt(netProfit);
  if (el('urban-urban-share')) el('urban-urban-share').textContent = fmt(urbanShare);
  if (el('urban-gm-share')) el('urban-gm-share').textContent = fmt(gmShare);
  if (el('urban-rent')) el('urban-rent').textContent = fmt(rent);
  if (el('urban-mgmt-display')) el('urban-mgmt-display').textContent = fmt(mgmtCost);
  if (el('urban-total-payment')) el('urban-total-payment').textContent = fmt(totalPayment);
}

// ---- 인사관리에서 인건비 가져오기 ----
function loadHRLaborCost() {
  try {
    const hrStore = JSON.parse(localStorage.getItem('gm_hr_data') || '{}');
    let totalPay = 0;

    // Get profiles and calculate pay
    Object.values(hrStore).forEach(hr => {
      if (hr.status === '퇴직' || hr.isPending) return;
      if (hr.department && hr.department !== '매장') return; // 매장직만

      if (hr.payType === '월급') {
        totalPay += hr.payAmount || 0;
      } else if (hr.payType === '시급') {
        // Estimate: ~160 hours/month for full-time
        totalPay += (hr.payAmount || 0) * 160;
      }
    });

    if (totalPay > 0) {
      document.getElementById('urban-labor-cost').value = totalPay;
      calculateUrbanSettlement();
      showToast('인사관리에서 매장직 인건비를 가져왔습니다: ' + totalPay.toLocaleString() + '원', 'success');
    } else {
      showToast('인사관리에 매장직 급여 데이터가 없습니다. 직접 입력해주세요.', 'info');
    }
  } catch (e) {
    showToast('인사관리 데이터를 가져올 수 없습니다.', 'error');
  }
}

// ---- 어반플레이 정산서 다운로드 ----
function downloadUrbanSettlement() {
  const monthInput = document.getElementById('urban-settle-month');
  const monthVal = monthInput ? monthInput.value : '';
  const monthStr = monthVal ? monthVal.replace('-', '년 ') + '월' : '';

  const storeSales = parseInt(document.getElementById('urban-store-sales').value) || 0;
  const gachaSales = parseInt(document.getElementById('urban-gacha-sales').value) || 0;
  const gachaCommission = Math.round(gachaSales * 0.22);
  const totalRevenue = storeSales + gachaCommission;

  const laborCost = parseInt(document.getElementById('urban-labor-cost').value) || 0;
  const suppliesCost = parseInt(document.getElementById('urban-supplies-cost').value) || 0;
  const mgmtCost = parseInt(document.getElementById('urban-mgmt-cost').value) || 0;
  const totalCost = laborCost + suppliesCost + mgmtCost;

  const costShare = Math.round(totalCost * 0.5);
  const netProfit = totalRevenue - totalCost + costShare;
  const urbanShare = Math.round(netProfit * 0.5);
  const gmShare = netProfit - urbanShare;
  const rent = 2500000;
  const subtotal = urbanShare + rent + mgmtCost;
  const vat = Math.round(subtotal * 0.1);
  const totalPayment = subtotal + vat;

  if (totalRevenue === 0 && totalCost === 0) {
    showToast('정산 데이터를 먼저 입력해주세요.', 'error');
    return;
  }

  const wb = XLSX.utils.book_new();

  // Sheet 1: 어반플레이 정산 확인서
  const sheet1Data = [
    [monthStr + ' 어반플레이 정산 확인서'],
    [],
    ['운영사', '', '주식회사 굿즈모먼트'],
    ['대 표', '', '육연식'],
    ['사업자번호', '', '250-88-03575'],
    [],
    ['구분', '항목', '금액'],
    [],
    ['수입', '1~3층 판매매출 (GM 25% 몫)', storeSales],
    ['', '가챠 매출 (22% 수수료)', gachaCommission],
    ['', '가챠 총매출 참고', gachaSales],
    ['', '매출 합계', totalRevenue],
    [],
    ['비용', '매장직 인건비', laborCost],
    ['', '소모품비', suppliesCost],
    ['', '관리비', mgmtCost],
    ['', '비용 합계', totalCost],
    [],
    ['정산', '비용보전 (비용의 50%)', costShare],
    ['', '순익 (매출 - 비용 + 비용보전)', netProfit],
    ['', '어반플레이 몫 (50%)', urbanShare],
    ['', '굿즈모먼트 몫 (50%)', gmShare],
    [],
    ['지급', '어반플레이 수익분배', urbanShare],
    ['', '3층 임대료', rent],
    ['', '관리비', mgmtCost],
    ['', '소계', subtotal],
    ['', '부가세 (10%)', vat],
    ['', '총 지급액 (VAT 포함)', totalPayment],
  ];

  const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
  ws1['!cols'] = [{ wch: 12 }, { wch: 32 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, ws1, '어반플레이 정산 확인서');

  // Sheet 2: 매출 상세
  const sheet2Data = [
    [monthStr + ' 매출 상세'],
    [],
    ['항목', '금액', '비고'],
    ['1~3층 판매매출 (GM 25% 몫)', storeSales, '제작사 정산 후 GM 위탁판매수수료'],
    ['가챠 총매출', gachaSales, ''],
    ['가챠 수수료 (22%)', gachaCommission, '가챠 총매출의 22%'],
    [],
    ['매출 합계', totalRevenue, ''],
  ];

  const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
  ws2['!cols'] = [{ wch: 32 }, { wch: 18 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws2, '매출 상세');

  // Sheet 3: 비용 상세
  const sheet3Data = [
    [monthStr + ' 비용 상세'],
    [],
    ['항목', '금액', '비고'],
    ['매장직 인건비', laborCost, '매장 근무 직원 급여'],
    ['소모품비', suppliesCost, '포장재, 비품 등'],
    ['관리비', mgmtCost, '건물 관리비'],
    [],
    ['비용 합계', totalCost, ''],
    ['어반플레이 부담분 (50%)', costShare, '비용의 50% 보전'],
    ['굿즈모먼트 부담분 (50%)', totalCost - costShare, ''],
  ];

  const ws3 = XLSX.utils.aoa_to_sheet(sheet3Data);
  ws3['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws3, '비용 상세');

  // 다운로드
  const fileName = '어반플레이_' + monthStr + '_정산서.xlsx';
  XLSX.writeFile(wb, fileName);
  showToast(fileName + ' 다운로드 완료', 'success');
}
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

  // 정산 이력 저장 (경영 리포트용)
  saveSettlementHistory(settleMonth, results, grandTotal);
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
  const tabs = ['publisher', 'urban', 'popup'];
  tabs.forEach(t => {
    const el = document.getElementById('settle-tab-' + t);
    const btn = document.getElementById('settle-tab-btn-' + t);
    if (el) el.style.display = (t === tab) ? 'block' : 'none';
    if (btn) {
      btn.style.borderBottomColor = (t === tab) ? 'var(--primary)' : 'transparent';
      btn.style.color = (t === tab) ? 'var(--primary)' : 'var(--gray-500)';
    }
  });

  if (tab === 'urban') {
    const monthInput = document.getElementById('urban-settle-month');
    if (monthInput && !monthInput.value) {
      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1);
      monthInput.value = lastMonth.getFullYear() + '-' + String(lastMonth.getMonth() + 1).padStart(2, '0');
    }
  }

  if (tab === 'popup') {
    // 프로젝트 목록 로드
    const select = document.getElementById('popup-settle-project');
    if (select) {
      const projects = JSON.parse(localStorage.getItem('gm_projects') || '[]');
      select.innerHTML = '<option value="">프로젝트를 선택하세요</option>' +
        projects.map(p => '<option value="' + p.id + '">' + p.name + ' (' + (p.floor || '') + ', ' + (p.startDate || '') + '~)</option>').join('');
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

  // 어반 정산 이력 저장 (경영 리포트용)
  const urbanMonth = document.getElementById('urban-settle-month') ? document.getElementById('urban-settle-month').value : '';
  if (urbanMonth) {
    saveUrbanHistory(urbanMonth, {
      revenue: totalRevenue,
      costs: totalCost,
      costShare: costShare,
      netProfit: netProfit,
      urbanShare: urbanShare,
      gmShare: gmShare,
      rent: rent,
      totalPayment: totalPayment,
      storeSales: storeSales,
      gachaSales: gachaSales,
      laborCost: laborCost,
      suppliesCost: suppliesCost,
      mgmtCost: mgmtCost
    });
  }
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

// ---- 제작사 정산에서 매출 가져오기 ----
function loadStoreSalesFromSettlement() {
  const history = JSON.parse(localStorage.getItem('gm_settlement_history') || '{}');
  const urbanMonth = document.getElementById('urban-settle-month') ? document.getElementById('urban-settle-month').value : '';

  if (!urbanMonth) {
    showToast('정산 월을 먼저 선택하세요.', 'error');
    return;
  }

  const monthData = history[urbanMonth];
  if (monthData && monthData.gmShare) {
    document.getElementById('urban-store-sales').value = monthData.gmShare;
    calculateUrbanSettlement();
    showToast(urbanMonth.replace('-', '년 ') + '월 제작사 정산 데이터에서 가져왔습니다: ₩' + monthData.gmShare.toLocaleString(), 'success');
  } else {
    showToast(urbanMonth.replace('-', '년 ') + '월 제작사 정산 데이터가 없습니다. 제작사 정산을 먼저 실행하세요.', 'info');
  }
}

// ---- 가챠 엑셀 업로드 ----
function handleGachaUpload(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      // 가챠 매출 합산 - 매출금액 컬럼 찾기
      let totalGacha = 0;
      let amountCol = -1;

      for (let i = 0; i < Math.min(rows.length, 5); i++) {
        rows[i].forEach((h, idx) => {
          const hs = String(h).replace(/\n/g, '').trim();
          if (hs === '금액' || hs === '매출' || hs.includes('매출') && hs.includes('금액')) amountCol = idx;
        });
        if (amountCol >= 0) break;
      }

      // 매출 컬럼 못 찾으면 마지막 숫자 컬럼 사용
      if (amountCol === -1) {
        // 가챠 형식: NO, 거래일자, 승인(건수,금액), 취소(건수,금액), 매출(건수,금액)
        // 매출 금액은 보통 7번째 컬럼 (index 7)
        amountCol = 7;
      }

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;
        const val = row[amountCol];
        if (val === undefined || val === null) continue;
        const num = typeof val === 'number' ? val : parseInt(String(val).replace(/[,₩\s]/g, '')) || 0;
        if (num > 0) totalGacha += num;
      }

      // 22% 수수료 적용
      const gachaCommission = Math.round(totalGacha * 0.22);

      document.getElementById('urban-gacha-sales').value = gachaCommission;
      calculateUrbanSettlement();
      showToast('가챠 매출 ₩' + totalGacha.toLocaleString() + ' → 22% 수수료: ₩' + gachaCommission.toLocaleString(), 'success');
    } catch (err) {
      showToast('가챠 엑셀 읽기 실패: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

// ---- 팝업 정산 ----
function loadPopupSettlement() {
  const select = document.getElementById('popup-settle-project');
  const content = document.getElementById('popup-settle-content');
  const projectId = select ? select.value : '';
  if (!projectId) { if (content) content.style.display = 'none'; return; }
  if (content) content.style.display = 'block';

  const projects = JSON.parse(localStorage.getItem('gm_projects') || '[]');
  const project = projects.find(p => p.id === projectId);
  if (!project) return;

  const fmt = n => '₩' + (n || 0).toLocaleString();
  const el = id => document.getElementById(id);

  const interior = project.budgetInterior || 0;
  const production = project.budgetProduction || 0;
  const giveaway = project.budgetGiveaway || 0;
  let laborCost = 0;
  if (project.workers) {
    project.workers.forEach(w => {
      const days = Math.max(1, Math.ceil((new Date(w.endDate || project.endDate) - new Date(w.startDate || project.startDate)) / 86400000) + 1);
      laborCost += (w.hourlyRate || 10320) * 8 * days;
    });
  }
  let otherCosts = 0;
  if (project.costs) project.costs.forEach(c => { otherCosts += c.amount || 0; });
  otherCosts += project.budgetOther || 0;
  const totalCost = interior + production + giveaway + laborCost + otherCosts;

  if (el('popup-cost-interior')) el('popup-cost-interior').textContent = fmt(interior);
  if (el('popup-cost-production')) el('popup-cost-production').textContent = fmt(production);
  if (el('popup-cost-giveaway')) el('popup-cost-giveaway').textContent = fmt(giveaway);
  if (el('popup-cost-labor')) el('popup-cost-labor').textContent = fmt(laborCost);
  if (el('popup-cost-total')) el('popup-cost-total').textContent = fmt(totalCost);

  const popupHistory = JSON.parse(localStorage.getItem('gm_popup_settlement') || '{}');
  if (popupHistory[projectId] && el('popup-actual-revenue')) {
    el('popup-actual-revenue').value = popupHistory[projectId].actualRevenue || '';
  }
  calculatePopupSettlement();
}

function calculatePopupSettlement() {
  const el = id => document.getElementById(id);
  const fmt = n => '₩' + (n || 0).toLocaleString();
  const revenue = parseInt(el('popup-actual-revenue')?.value) || 0;
  const costText = el('popup-cost-total')?.textContent || '₩0';
  const totalCost = parseInt(costText.replace(/[₩,]/g, '')) || 0;
  const profit = revenue - totalCost;

  if (el('popup-result-revenue')) el('popup-result-revenue').textContent = fmt(revenue);
  if (el('popup-result-cost')) el('popup-result-cost').textContent = fmt(totalCost);
  if (el('popup-result-profit')) {
    el('popup-result-profit').textContent = fmt(profit);
    el('popup-result-profit').style.color = profit >= 0 ? 'var(--green)' : 'var(--red)';
  }

  const select = document.getElementById('popup-settle-project');
  if (select && select.value && revenue > 0) {
    const history = JSON.parse(localStorage.getItem('gm_popup_settlement') || '{}');
    history[select.value] = { actualRevenue: revenue, totalCost: totalCost, profit: profit, date: new Date().toISOString() };
    localStorage.setItem('gm_popup_settlement', JSON.stringify(history));
  }
}

function downloadPopupSettlement() {
  const select = document.getElementById('popup-settle-project');
  if (!select || !select.value) { showToast('프로젝트를 선택하세요', 'error'); return; }
  const projects = JSON.parse(localStorage.getItem('gm_projects') || '[]');
  const project = projects.find(p => p.id === select.value);
  if (!project) return;

  const revenue = parseInt(document.getElementById('popup-actual-revenue')?.value) || 0;
  const costText = document.getElementById('popup-cost-total')?.textContent || '₩0';
  const totalCost = parseInt(costText.replace(/[₩,]/g, '')) || 0;

  const wb = XLSX.utils.book_new();
  const data = [
    ['팝업 프로젝트 정산서'], [],
    ['프로젝트명', '', project.name],
    ['IP/작품', '', project.ip || ''],
    ['기간', '', (project.startDate || '') + ' ~ ' + (project.endDate || '')],
    ['층', '', project.floor || ''],
    [],
    ['[비용]'],
    ['인테리어/디자인', '', project.budgetInterior || 0],
    ['굿즈 제작', '', project.budgetProduction || 0],
    ['증정 굿즈', '', project.budgetGiveaway || 0],
    ['알바 인건비', '', parseInt(document.getElementById('popup-cost-labor')?.textContent?.replace(/[₩,]/g, '')) || 0],
    ['기타', '', project.budgetOther || 0],
    ['비용 합계', '', totalCost],
    [],
    ['[매출]'],
    ['실제 매출', '', revenue],
    [],
    ['[순익]'],
    ['매출 - 비용', '', revenue - totalCost],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{wch:16},{wch:4},{wch:18}];
  XLSX.utils.book_append_sheet(wb, ws, '팝업정산');
  XLSX.writeFile(wb, project.name + '_정산서.xlsx');
  showToast(project.name + ' 정산서 다운로드 완료', 'success');
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

// ============================================
// SETTLEMENT HISTORY & REPORT (경영 리포트)
// ============================================

// ---- 정산 이력 저장 ----
function saveSettlementHistory(month, results, grandTotal) {
  const history = JSON.parse(localStorage.getItem('gm_settlement_history') || '{}');
  history[month] = {
    date: new Date().toISOString(),
    month: month,
    totalSales: grandTotal.totalSales,
    netSales: grandTotal.netSales,
    publisherShare: grandTotal.publisherShare,
    gmShare: grandTotal.gmShare,
    publisherCount: results.length,
    publishers: results.map(r => ({
      name: r.name,
      totalSales: r.totalSales,
      netAmount: r.netAmount,
      publisherShare: r.publisherShare,
      gmShare: r.gmShare,
      rate: r.rate,
      rateType: r.rateType
    }))
  };
  localStorage.setItem('gm_settlement_history', JSON.stringify(history));
}

// ---- 어반 정산 이력 저장 ----
function saveUrbanHistory(month, data) {
  const history = JSON.parse(localStorage.getItem('gm_urban_history') || '{}');
  history[month] = {
    date: new Date().toISOString(),
    month: month,
    ...data
  };
  localStorage.setItem('gm_urban_history', JSON.stringify(history));
}

// ---- 샘플 데이터 (빈 리포트 방지) ----
function getSettlementHistory() {
  const existing = localStorage.getItem('gm_settlement_history');
  if (existing) return JSON.parse(existing);

  // Sample data so report isn't empty
  const defaults = {
    '2026-01': {
      date: '2026-02-10',
      month: '2026-01',
      totalSales: 12218310,
      netSales: 11107554,
      gmShare: 2997970,
      publisherShare: 8993910,
      publisherCount: 5,
      publishers: [
        { name: '북극여우', totalSales: 1785600, publisherShare: 1188162, gmShare: 396054, rate: 0.25, rateType: 'net' },
        { name: '작두', totalSales: 3200000, publisherShare: 2133333, gmShare: 711111, rate: 0.25, rateType: 'net' },
        { name: '킬러배드로', totalSales: 2100000, publisherShare: 1400000, gmShare: 466667, rate: 0.25, rateType: 'net' },
        { name: '마루는강쥐', totalSales: 1800000, publisherShare: 1200000, gmShare: 400000, rate: 0.25, rateType: 'net' },
        { name: '세레나', totalSales: 900000, publisherShare: 600000, gmShare: 200000, rate: 0.25, rateType: 'net' }
      ]
    }
  };
  localStorage.setItem('gm_settlement_history', JSON.stringify(defaults));
  return defaults;
}

// ---- 리포트 로드 ----
function loadReport() {
  const period = document.getElementById('report-period') ? document.getElementById('report-period').value : 'monthly';
  const year = document.getElementById('report-year') ? document.getElementById('report-year').value : '2026';

  // 기간에 따라 라벨 업데이트
  const periodLabels = { monthly: year + '년', quarterly: year + '년', half: year + '년', yearly: year + '년' };
  const prefix = periodLabels[period] || year + '년';
  const el = (id) => document.getElementById(id);
  if (el('report-label-sales')) el('report-label-sales').textContent = prefix + ' 총매출';
  if (el('report-label-gm')) el('report-label-gm').textContent = prefix + ' 굿즈모먼트 수익';
  if (el('report-label-pub')) el('report-label-pub').textContent = prefix + ' 제작사 정산';
  if (el('report-label-urban')) el('report-label-urban').textContent = prefix + ' 어반플레이 정산';

  renderReportStats(year);
  renderMonthlyChart(year);
  renderPublisherSummary(year);
  renderUrbanHistory(year);
  renderCostSummary(year);
}

// ---- 연간 통계 카드 ----
function renderReportStats(year) {
  const history = getSettlementHistory();
  let totalSales = 0, gmShare = 0, pubShare = 0;

  Object.entries(history).forEach(([month, data]) => {
    if (month.startsWith(year)) {
      totalSales += data.totalSales || 0;
      gmShare += data.gmShare || 0;
      pubShare += data.publisherShare || 0;
    }
  });

  // Update stats cards
  const elSales = document.getElementById('report-year-sales');
  const elGm = document.getElementById('report-year-gm');
  const elPub = document.getElementById('report-year-publisher');
  if (elSales) elSales.textContent = '₩' + totalSales.toLocaleString();
  if (elGm) elGm.textContent = '₩' + gmShare.toLocaleString();
  if (elPub) elPub.textContent = '₩' + pubShare.toLocaleString();

  // Urban totals
  const urbanHistory = JSON.parse(localStorage.getItem('gm_urban_history') || '{}');
  let urbanTotal = 0;
  Object.entries(urbanHistory).forEach(([month, data]) => {
    if (month.startsWith(year)) urbanTotal += data.totalPayment || 0;
  });
  const elUrban = document.getElementById('report-year-urban');
  if (elUrban) elUrban.textContent = '₩' + urbanTotal.toLocaleString();
}

// ---- 월별 매출 바 차트 ----
function renderMonthlyChart(year) {
  const history = getSettlementHistory();
  const container = document.getElementById('report-monthly-chart');
  if (!container) return;

  const months = [];
  for (let m = 1; m <= 12; m++) {
    const key = year + '-' + String(m).padStart(2, '0');
    const data = history[key];
    months.push({
      month: m,
      label: m + '월',
      sales: data ? data.totalSales : 0,
      gm: data ? data.gmShare : 0
    });
  }

  const maxSales = Math.max(...months.map(m => m.sales), 1);

  container.innerHTML = '<div style="display:flex; align-items:flex-end; gap:6px; height:200px; padding:0;">' +
    months.map(function(m) {
      var height = m.sales > 0 ? Math.max((m.sales / maxSales) * 100, 5) : 2;
      var salesStr = m.sales > 1000000 ? (m.sales / 1000000).toFixed(1) + 'M' : m.sales > 1000 ? (m.sales / 1000).toFixed(0) + 'K' : m.sales;
      return '<div style="flex:1; text-align:center; display:flex; flex-direction:column; justify-content:flex-end; height:100%;">' +
        '<div style="background:' + (m.sales > 0 ? 'var(--primary)' : 'var(--gray-200)') + '; border-radius:4px 4px 0 0; height:' + height + '%; min-height:4px; transition:height 0.3s;"></div>' +
        '<div style="font-size:11px; margin-top:4px; font-weight:600;">' + m.label + '</div>' +
        '<div style="font-size:9px; color:var(--gray-500);">' + (m.sales > 0 ? '₩' + salesStr : '-') + '</div>' +
      '</div>';
    }).join('') +
  '</div>';
}

// ---- 제작사별 누적 정산 테이블 ----
function renderPublisherSummary(year) {
  const history = getSettlementHistory();
  const byPublisher = {};
  const byPublisherMonthly = {}; // 월별 상세 데이터

  Object.entries(history).forEach(([month, data]) => {
    if (!month.startsWith(year) || !data.publishers) return;
    data.publishers.forEach(function(pub) {
      if (!byPublisher[pub.name]) {
        byPublisher[pub.name] = { totalSales: 0, publisherShare: 0, gmShare: 0, count: 0 };
        byPublisherMonthly[pub.name] = {};
      }
      byPublisher[pub.name].totalSales += pub.totalSales || 0;
      byPublisher[pub.name].publisherShare += pub.publisherShare || 0;
      byPublisher[pub.name].gmShare += pub.gmShare || 0;
      byPublisher[pub.name].count++;
      // 월별 저장
      byPublisherMonthly[pub.name][month] = {
        totalSales: pub.totalSales || 0,
        publisherShare: pub.publisherShare || 0,
        gmShare: pub.gmShare || 0
      };
    });
  });

  const sorted = Object.entries(byPublisher).sort(function(a, b) { return b[1].totalSales - a[1].totalSales; });
  const grandTotal = sorted.reduce(function(acc, entry) {
    var v = entry[1];
    return { totalSales: acc.totalSales + v.totalSales, publisherShare: acc.publisherShare + v.publisherShare, gmShare: acc.gmShare + v.gmShare };
  }, { totalSales: 0, publisherShare: 0, gmShare: 0 });

  const tbody = document.getElementById('report-publisher-table');
  if (!tbody) return;

  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">정산 데이터가 없습니다. 정산을 실행하면 자동으로 누적됩니다.</td></tr>';
    return;
  }

  // 월별 상세를 window에 저장 (토글용)
  window._pubMonthly = byPublisherMonthly;
  window._pubYear = year;

  tbody.innerHTML = sorted.map(function(entry) {
    var name = entry[0], v = entry[1];
    var pct = grandTotal.totalSales > 0 ? ((v.totalSales / grandTotal.totalSales) * 100).toFixed(1) : 0;
    var safeId = name.replace(/[^가-힣a-zA-Z0-9]/g, '_');
    return '<tr style="cursor:pointer;" onclick="togglePublisherDetail(\'' + name + '\', \'' + safeId + '\')">' +
      '<td style="font-weight:600;">▸ ' + name + '</td>' +
      '<td>₩' + v.totalSales.toLocaleString() + '</td>' +
      '<td style="color:var(--blue);">₩' + v.publisherShare.toLocaleString() + '</td>' +
      '<td style="color:var(--primary); font-weight:700;">₩' + v.gmShare.toLocaleString() + '</td>' +
      '<td>' + v.count + '회</td>' +
      '<td>' + pct + '%</td>' +
    '</tr>' +
    '<tr id="pub-detail-' + safeId + '" style="display:none;"><td colspan="6" style="padding:0;"><div style="background:var(--gray-50); padding:12px 16px;" id="pub-detail-content-' + safeId + '"></div></td></tr>';
  }).join('');

  var elTotalSales = document.getElementById('report-pub-total-sales');
  var elTotalShare = document.getElementById('report-pub-total-share');
  var elTotalGm = document.getElementById('report-pub-total-gm');
  if (elTotalSales) elTotalSales.textContent = '₩' + grandTotal.totalSales.toLocaleString();
  if (elTotalShare) elTotalShare.textContent = '₩' + grandTotal.publisherShare.toLocaleString();
  if (elTotalGm) elTotalGm.textContent = '₩' + grandTotal.gmShare.toLocaleString();
}

// ---- 제작사 월별 상세 토글 ----
function togglePublisherDetail(name, safeId) {
  var row = document.getElementById('pub-detail-' + safeId);
  var content = document.getElementById('pub-detail-content-' + safeId);
  if (!row || !content) return;

  if (row.style.display === 'none') {
    row.style.display = '';
    var monthly = (window._pubMonthly && window._pubMonthly[name]) || {};
    var year = window._pubYear || '2026';

    var months = [];
    var maxSales = 0;
    for (var m = 1; m <= 12; m++) {
      var key = year + '-' + String(m).padStart(2, '0');
      var d = monthly[key] || { totalSales: 0, publisherShare: 0, gmShare: 0 };
      months.push({ month: m, label: m + '월', ...d });
      if (d.totalSales > maxSales) maxSales = d.totalSales;
    }

    var totalSales = months.reduce(function(s, m) { return s + m.totalSales; }, 0);
    var avgSales = Math.round(totalSales / (months.filter(function(m) { return m.totalSales > 0; }).length || 1));

    var html = '<div style="font-size:14px; font-weight:700; margin-bottom:12px;">' + name + ' — ' + year + '년 월별 매출</div>';

    // 바 차트
    html += '<div style="display:flex; align-items:flex-end; gap:4px; height:120px; margin-bottom:12px;">';
    months.forEach(function(m) {
      var h = maxSales > 0 ? Math.max((m.totalSales / maxSales) * 100, 3) : 3;
      var salesStr = m.totalSales > 0 ? '₩' + (m.totalSales / 10000).toFixed(0) + '만' : '-';
      html += '<div style="flex:1; text-align:center; display:flex; flex-direction:column; justify-content:flex-end; height:100%;">' +
        '<div style="background:' + (m.totalSales > 0 ? 'var(--primary)' : 'var(--gray-200)') + '; border-radius:3px 3px 0 0; height:' + h + '%; min-height:3px;"></div>' +
        '<div style="font-size:10px; margin-top:2px;">' + m.label + '</div>' +
        '<div style="font-size:9px; color:var(--gray-500);">' + salesStr + '</div>' +
      '</div>';
    });
    html += '</div>';

    // 월별 테이블
    html += '<table style="width:100%; font-size:12px; min-width:auto;"><thead><tr><th>월</th><th>총매출</th><th>제작사 정산</th><th>GM 수익</th></tr></thead><tbody>';
    months.forEach(function(m) {
      if (m.totalSales === 0) return;
      html += '<tr><td>' + m.label + '</td><td>₩' + m.totalSales.toLocaleString() + '</td><td>₩' + m.publisherShare.toLocaleString() + '</td><td style="color:var(--primary); font-weight:600;">₩' + m.gmShare.toLocaleString() + '</td></tr>';
    });
    html += '</tbody></table>';

    // 요약
    html += '<div style="display:flex; gap:16px; margin-top:12px; padding-top:8px; border-top:1px solid var(--gray-200); font-size:13px;">' +
      '<div><span style="color:var(--gray-500);">합계:</span> <strong>₩' + totalSales.toLocaleString() + '</strong></div>' +
      '<div><span style="color:var(--gray-500);">월평균:</span> <strong>₩' + avgSales.toLocaleString() + '</strong></div>' +
    '</div>';

    content.innerHTML = html;
  } else {
    row.style.display = 'none';
  }
}

// ---- 어반플레이 정산 이력 테이블 ----
function renderUrbanHistory(year) {
  const history = JSON.parse(localStorage.getItem('gm_urban_history') || '{}');
  const tbody = document.getElementById('report-urban-table');
  if (!tbody) return;

  const entries = Object.entries(history).filter(function(e) { return e[0].startsWith(year); }).sort(function(a, b) { return a[0].localeCompare(b[0]); });

  if (entries.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">어반플레이 정산 데이터가 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = entries.map(function(entry) {
    var month = entry[0], d = entry[1];
    return '<tr>' +
      '<td style="font-weight:600;">' + month.replace('-', '년 ') + '월</td>' +
      '<td>₩' + (d.revenue || 0).toLocaleString() + '</td>' +
      '<td>₩' + (d.costs || 0).toLocaleString() + '</td>' +
      '<td style="font-weight:700;">₩' + (d.netProfit || 0).toLocaleString() + '</td>' +
      '<td>₩' + (d.urbanShare || 0).toLocaleString() + '</td>' +
      '<td style="color:var(--primary); font-weight:700;">₩' + (d.gmShare || 0).toLocaleString() + '</td>' +
    '</tr>';
  }).join('');
}

// ---- 비용 요약 ----
function renderCostSummary(year) {
  const urbanHistory = JSON.parse(localStorage.getItem('gm_urban_history') || '{}');
  const settlementHistory = getSettlementHistory();

  // HR 월급 계산 (매월 동일하다고 가정)
  const hrData = JSON.parse(localStorage.getItem('gm_hr_data') || '{}');
  let monthlyLabor = 0;
  Object.values(hrData).forEach(function(staff) {
    if (staff.status === '퇴직' || staff.isPending) return;
    const pay = parseInt(staff.payAmount) || 0;
    const type = staff.payType || 'monthly';
    monthlyLabor += type === 'hourly' || type === '시급' ? pay * 209 : pay;
  });

  // 월별 데이터 조합
  var months = [];
  var totals = { sales: 0, labor: 0, supplies: 0, mgmt: 0, urbanPay: 0, gmNet: 0 };

  for (var m = 1; m <= 12; m++) {
    var key = year + '-' + String(m).padStart(2, '0');
    var urban = urbanHistory[key] || {};
    var settle = settlementHistory[key] || {};

    var sales = settle.totalSales || urban.revenue || 0;
    var labor = urban.laborCost || (sales > 0 ? monthlyLabor : 0);
    var supplies = urban.suppliesCost || 0;
    var mgmt = urban.mgmtCost || 0;
    var urbanPay = urban.totalPayment || 0;
    var gmNet = urban.gmShare || 0;

    if (sales > 0 || labor > 0 || urbanPay > 0) {
      totals.sales += sales;
      totals.labor += labor;
      totals.supplies += supplies;
      totals.mgmt += mgmt;
      totals.urbanPay += urbanPay;
      totals.gmNet += gmNet;
    }

    months.push({ month: m, label: m + '월', sales: sales, labor: labor, supplies: supplies, mgmt: mgmt, urbanPay: urbanPay, gmNet: gmNet });
  }

  // 요약 카드 업데이트
  var fmt = function(n) { return '₩' + n.toLocaleString(); };
  var el = function(id) { return document.getElementById(id); };
  if (el('report-total-labor')) el('report-total-labor').textContent = fmt(totals.labor);
  if (el('report-total-supplies')) el('report-total-supplies').textContent = fmt(totals.supplies);
  if (el('report-total-urban-pay')) el('report-total-urban-pay').textContent = fmt(totals.urbanPay);
  if (el('report-total-gm-net')) el('report-total-gm-net').textContent = fmt(totals.gmNet);

  // 월별 테이블
  var tbody = document.getElementById('report-cost-monthly-table');
  if (!tbody) return;

  var hasData = months.some(function(m) { return m.sales > 0 || m.labor > 0; });
  if (!hasData) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">비용 데이터가 없습니다. 어반 정산을 실행하면 자동으로 누적됩니다.</td></tr>';
    return;
  }

  tbody.innerHTML = months.filter(function(m) { return m.sales > 0 || m.labor > 0 || m.urbanPay > 0; }).map(function(m) {
    return '<tr>' +
      '<td style="font-weight:600;">' + m.label + '</td>' +
      '<td>' + fmt(m.sales) + '</td>' +
      '<td>' + fmt(m.labor) + '</td>' +
      '<td>' + fmt(m.supplies) + '</td>' +
      '<td>' + fmt(m.mgmt) + '</td>' +
      '<td style="color:var(--blue);">' + fmt(m.urbanPay) + '</td>' +
      '<td style="color:var(--green); font-weight:700;">' + fmt(m.gmNet) + '</td>' +
    '</tr>';
  }).join('');

  // 합계
  if (el('report-cost-foot-sales')) el('report-cost-foot-sales').textContent = fmt(totals.sales);
  if (el('report-cost-foot-labor')) el('report-cost-foot-labor').textContent = fmt(totals.labor);
  if (el('report-cost-foot-supplies')) el('report-cost-foot-supplies').textContent = fmt(totals.supplies);
  if (el('report-cost-foot-mgmt')) el('report-cost-foot-mgmt').textContent = fmt(totals.mgmt);
  if (el('report-cost-foot-urban')) el('report-cost-foot-urban').textContent = fmt(totals.urbanPay);
  if (el('report-cost-foot-gm')) el('report-cost-foot-gm').textContent = fmt(totals.gmNet);
}
/**
 * Academic Kundali — PDF (jsPDF). Layout aligned to reference: header → title → student → analysis → careers → footer.
 *
 * @typedef {Object} CareerPaths
 * @property {string[]} [engineering]
 * @property {string[]} [informationTechnology]
 * @property {string[]} [mathematicsStatistics]
 * @property {string[]} [physicalSciences]
 *
 * @typedef {Object} PDFReportProps
 * @property {string} name
 * @property {string} email
 * @property {string} phone
 * @property {string} recommendedStream
 * @property {number} confidence
 * @property {CareerPaths} careerPaths
 */

import { jsPDF } from 'jspdf';

export const PDF_FILENAME = 'academic_kundali_report.pdf';

/** Match reference copy (Badli Road). */
const ADDRESS_LINE = 'Address: Badli Road Chandu, Budhera, Gurugram, Haryana 122505';
const TOLL_LINE = 'Toll Free: 1800 102 5661';

const MARGIN_X = 20;
const MARGIN_BOTTOM = 20;
const LINE_BODY = 5.5;
const LINE_GAP = 1.2;

const TEXT_MAIN = [15, 23, 42];
const TEXT_MUTED = [71, 85, 105];
const TEXT_ACCENT = [2, 132, 199];

const CATEGORY_LABELS = [
  ['engineering', 'Engineering'],
  ['informationTechnology', 'Information Technology'],
  ['mathematicsStatistics', 'Mathematics & Statistics'],
  ['physicalSciences', 'Physical Sciences'],
];

/**
 * @param {jsPDF} doc
 * @param {number} pageW
 * @param {number} pageH
 */
function drawFooter(doc, pageW, pageH) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT_MUTED);
  doc.text(ADDRESS_LINE, pageW / 2, pageH - MARGIN_BOTTOM + 4, { align: 'center' });
  doc.text(TOLL_LINE, pageW / 2, pageH - MARGIN_BOTTOM + 9, { align: 'center' });
}

/**
 * Top header (address + toll free), centered — same text as bottom footer per reference.
 * @param {jsPDF} doc
 * @param {number} pageW
 * @returns {number} y position below header block for body content
 */
function drawTopHeader(doc, pageW) {
  const y0 = 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT_MUTED);
  doc.text(ADDRESS_LINE, pageW / 2, y0, { align: 'center' });
  doc.text(TOLL_LINE, pageW / 2, y0 + 5, { align: 'center' });
  return y0 + 12;
}

/**
 * @param {PDFReportProps} props
 * @returns {jsPDF}
 */
export function generatePDF(props) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
    putOnlyUsedFonts: true,
  });

  doc.setProperties({
    title: 'Academic Kundali',
    subject: 'Career analysis report',
    creator: 'Academic Kundali',
  });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const contentW = pageW - MARGIN_X * 2;
  const maxY = pageH - MARGIN_BOTTOM - 12;

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageW, pageH, 'F');

  let y = drawTopHeader(doc, pageW);

  const ensureSpace = (neededMm) => {
    if (y + neededMm > maxY) {
      doc.addPage();
      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, pageW, pageH, 'F');
      y = drawTopHeader(doc, pageW);
    }
  };

  // —— Main title (first page only; continuation pages resume below header) ——
  ensureSpace(22);
  doc.setTextColor(...TEXT_MAIN);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('Academic Kundali', pageW / 2, y, { align: 'center' });
  y += 12;

  // —— Student information row ——
  ensureSpace(20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const nameStr = `Name: ${props.name ?? '—'}`;
  const emailStr = `Email: ${props.email ?? '—'}`;
  const phoneStr = `Phone: ${props.phone ?? '—'}`;
  const colW = contentW / 3;
  doc.setTextColor(...TEXT_MAIN);
  doc.text(nameStr, MARGIN_X, y);
  doc.setTextColor(...TEXT_ACCENT);
  doc.text(emailStr, MARGIN_X + colW, y);
  doc.setTextColor(...TEXT_MAIN);
  doc.text(phoneStr, MARGIN_X + 2 * colW, y);
  y += 10;

  // —— Analysis ——
  ensureSpace(22);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...TEXT_MAIN);
  doc.text(`Recommended Stream: ${props.recommendedStream ?? '—'}`, MARGIN_X, y);
  y += 7;
  const conf =
    typeof props.confidence === 'number' && Number.isFinite(props.confidence)
      ? props.confidence.toFixed(2)
      : '—';
  doc.text(`Confidence: ${conf}%`, MARGIN_X, y);
  y += 11;

  // —— Suggested Career Paths ——
  ensureSpace(14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text('Suggested Career Paths', MARGIN_X, y);
  y += 8;

  const careerPaths = props.careerPaths || {};

  for (const [key, label] of CATEGORY_LABELS) {
    const items = careerPaths[key];
    if (!items || !items.length) continue;

    ensureSpace(16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...TEXT_MAIN);
    doc.text(`Category Heading: ${label}`, MARGIN_X, y);
    y += 7;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    for (const item of items) {
      const bullet = `• ${item}`;
      const lines = doc.splitTextToSize(bullet, contentW - 8);
      for (const line of lines) {
        ensureSpace(LINE_BODY + LINE_GAP);
        doc.setTextColor(...TEXT_MAIN);
        doc.text(line, MARGIN_X + 5, y);
        y += LINE_BODY;
      }
    }
    y += 5;
  }

  // Footer on every page
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawFooter(doc, pageW, pageH);
  }

  doc.setPage(1);
  return doc;
}

/**
 * @param {PDFReportProps} props
 * @returns {Blob}
 */
export function generatePDFBlob(props) {
  const doc = generatePDF(props);
  return doc.output('blob');
}

/**
 * @param {PDFReportProps} props
 * @param {string} [filename]
 */
export function downloadPDF(props, filename = PDF_FILENAME) {
  const doc = generatePDF(props);
  doc.save(filename);
}

/**
 * @param {PDFReportProps} props
 * @param {string} [filename]
 * @returns {Promise<void>}
 */
export async function sharePDF(props, filename = PDF_FILENAME) {
  const blob = generatePDFBlob(props);
  const file = new File([blob], filename, { type: 'application/pdf' });

  const canShareFiles =
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] });

  if (canShareFiles) {
    try {
      await navigator.share({
        files: [file],
        title: 'Academic Kundali',
        text: 'Career analysis report (PDF)',
      });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      downloadPDF(props, filename);
      return;
    }
  }

  downloadPDF(props, filename);
}

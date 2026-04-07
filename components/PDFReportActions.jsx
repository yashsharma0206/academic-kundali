'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  downloadPDF,
  sharePDF,
  PDF_FILENAME,
} from '../lib/pdfReportHelpers';
import styles from './PDFReportActions.module.css';

/**
 * @typedef {Object} CareerPaths
 * @property {string[]} [engineering]
 * @property {string[]} [informationTechnology]
 * @property {string[]} [mathematicsStatistics]
 * @property {string[]} [physicalSciences]
 */

/**
 * @typedef {Object} PDFReportActionsProps
 * @property {string} name
 * @property {string} email
 * @property {string} phone
 * @property {string} recommendedStream
 * @property {number} confidence
 * @property {CareerPaths} careerPaths
 * @property {string} [className]
 */

/**
 * Production-ready actions: download & share Academic Kundali PDF (jsPDF).
 * Use in Next.js App Router as a Client Component, or in plain React (web).
 *
 * @param {PDFReportActionsProps} props
 */
export default function PDFReportActions(props) {
  const {
    name,
    email,
    phone,
    recommendedStream,
    confidence,
    careerPaths,
    className,
  } = props;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const payload = useMemo(
    () => ({
      name,
      email,
      phone,
      recommendedStream,
      confidence,
      careerPaths,
    }),
    [name, email, phone, recommendedStream, confidence, careerPaths],
  );

  const handleDownload = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 0));
      downloadPDF(payload, PDF_FILENAME);
    } catch (e) {
      setError(e?.message || 'Could not generate PDF.');
    } finally {
      setLoading(false);
    }
  }, [payload]);

  const handleShare = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 0));
      await sharePDF(payload, PDF_FILENAME);
    } catch (e) {
      setError(e?.message || 'Could not share PDF.');
    } finally {
      setLoading(false);
    }
  }, [payload]);

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <div className={styles.row}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          disabled={loading}
          onClick={handleDownload}
        >
          {loading ? 'Preparing…' : 'Download PDF Report'}
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnSecondary}`}
          disabled={loading}
          onClick={handleShare}
        >
          {loading ? 'Preparing…' : 'Share Report'}
        </button>
      </div>
      <p className={styles.hint}>
        Share uses the Web Share API when available (WhatsApp, Gmail, Drive, etc.).
        Otherwise the PDF downloads automatically.
      </p>
      {error ? <p className={styles.err}>{error}</p> : null}
    </div>
  );
}

export {
  downloadPDF,
  sharePDF,
  PDF_FILENAME,
  generatePDF,
  generatePDFBlob,
} from '../lib/pdfReportHelpers';

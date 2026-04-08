import React, { Component, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  ScrollView,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Share,
  Modal,
  Switch,
  useColorScheme,
  Alert,
  ActivityIndicator,
  InteractionManager,
} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as Linking from 'expo-linking';
import * as FileSystem from 'expo-file-system/legacy';
import { Asset } from 'expo-asset';
import Slider from '@react-native-community/slider';
import { StatusBar } from 'expo-status-bar';
import { CAREER_MAP } from './careerMap';
import { computeScores, normalizedRadarValues, predictStream } from './academicKundaliLogic';
import RadarChart from './RadarChart';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from './lib/supabase';

/** Bundled image for PDF/print header (JPEG; must match file in ./assets/). */
const PDF_REPORT_BANNER = require('./assets/sgt-report-banner-logo.jpg');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeFilenamePart(s) {
  return String(s || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 60);
}

/** Old share/QR links used stream name "Science (Math)". */
function normalizeStreamFromDeepLink(stream) {
  if (stream === 'Science (Math)') return 'Science & Engineering';
  return stream;
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const out = reader.result;
      resolve(typeof out === 'string' ? out : '');
    };
    reader.onerror = () => reject(new Error('FileReader'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Embeds a bundled image as a data URI for expo-print HTML.
 * Native: uses expo-file-system/legacy (SDK 54 main `expo-file-system` readAsStringAsync throws).
 */
async function assetToDataUri(assetModuleId, mimeType = 'image/png') {
  const asset = Asset.fromModule(assetModuleId);
  try {
    await asset.downloadAsync();
  } catch (e) {
    console.warn('[PDF] Asset.downloadAsync:', e?.message);
  }

  const resolved = Image.resolveAssetSource(assetModuleId);

  if (Platform.OS === 'web') {
    const localPath = asset.localUri || asset.uri || resolved?.uri;
    if (!localPath) return '';
    try {
      const res = await fetch(localPath);
      if (!res.ok) return '';
      return await blobToDataUrl(await res.blob());
    } catch (e) {
      console.warn('[PDF] web banner fetch:', e?.message);
      return '';
    }
  }

  const toFileUri = (path) => {
    if (path == null) return '';
    const p = String(path);
    if (p.startsWith('file://') || p.startsWith('http://') || p.startsWith('https://')) return p;
    if (Platform.OS === 'android' && p.startsWith('/')) return `file://${p}`;
    return p;
  };

  const candidates = [asset.localUri, asset.uri, resolved?.uri].filter(Boolean);
  const unique = [...new Set(candidates.map(String))];

  for (const raw of unique) {
    const uri = toFileUri(raw);
    try {
      if (uri.startsWith('http://') || uri.startsWith('https://')) {
        const res = await fetch(uri);
        if (!res.ok) continue;
        const out = await blobToDataUrl(await res.blob());
        if (out) return out;
      } else if (uri) {
        const b64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (b64) return `data:${mimeType};base64,${b64}`;
      }
    } catch (e) {
      console.warn('[PDF] banner read failed:', String(raw).slice(0, 72), e?.message);
    }
  }

  const from = unique[0];
  if (from && FileSystem.cacheDirectory) {
    const dest = `${FileSystem.cacheDirectory}sgt_pdf_banner_${Date.now()}.png`;
    try {
      await FileSystem.copyAsync({ from, to: dest });
      const b64 = await FileSystem.readAsStringAsync(dest, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (b64) return `data:${mimeType};base64,${b64}`;
    } catch (e) {
      console.warn('[PDF] banner copyAsync fallback:', e?.message);
    }
  }

  return '';
}

function renderCareerCategories(categories) {
  return (categories || [])
    .map(
      (cat) => `
    <div class="career-block">
      <div class="cat-title">${escapeHtml(cat.title)}</div>
      <ul class="bullets">${(cat.items || []).map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
    </div>`,
    )
    .join('');
}

function clampPdfRadar01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** PDF only: Interest profile — pill badge (stream · %) + 4-axis radar (matches in-app RadarChart). */
function renderInterestProfilePdfHtml(result) {
  const radar = result?.radar;
  if (!radar || typeof radar !== 'object') {
    return `<div class="ip-title">Interest profile</div><p class="ip-na">Not available for this report.</p>`;
  }
  const streamSafe = escapeHtml(result.prediction?.stream || '');
  const pctInt = Math.round(Number(result.prediction?.confidence) || 0);
  const stem = clampPdfRadar01(radar.STEM);
  const biology = clampPdfRadar01(radar.Biology);
  const commerce = clampPdfRadar01(radar.Commerce);
  const arts = clampPdfRadar01(radar.Arts);
  const vals = [stem, biology, commerce, arts];

  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.38;

  const pt = (i, scale) => {
    const r = R * scale;
    const coords = [
      [cx, cy - r],
      [cx + r, cy],
      [cx, cy + r],
      [cx - r, cy],
    ];
    return coords[i];
  };

  const gridPolys = [0.25, 0.5, 0.75, 1]
    .map((g) => {
      const pts = [0, 1, 2, 3].map((i) => pt(i, g));
      const s = pts.map((p) => `${p[0]},${p[1]}`).join(' ');
      return `<polygon points="${s}" fill="none" stroke="#e2e8f0" stroke-width="1"/>`;
    })
    .join('');

  const axisLines = [0, 1, 2, 3]
    .map((i) => {
      const e = pt(i, 1);
      return `<line x1="${cx}" y1="${cy}" x2="${e[0]}" y2="${e[1]}" stroke="#e2e8f0" stroke-width="1"/>`;
    })
    .join('');

  const polyStr = [0, 1, 2, 3]
    .map((i) => {
      const p = pt(i, vals[i]);
      return `${p[0]},${p[1]}`;
    })
    .join(' ');

  const svgInner = `${gridPolys}${axisLines}<circle cx="${cx}" cy="${cy}" r="3" fill="#94a3b8"/><polygon points="${polyStr}" fill="rgba(13,148,136,0.25)" stroke="#0d9488" stroke-width="2"/>`;

  return `
    <div class="ip-title">Interest profile</div>
    <div class="ip-badge">${streamSafe} · ${pctInt}%</div>
    <div class="ip-chart-box">
      <div class="ip-lbl ip-lbl-top">Science &amp; Engineering</div>
      <div class="ip-chart-mid">
        <div class="ip-lbl-side ip-lbl-left">Arts</div>
        <svg class="ip-radar" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${svgInner}</svg>
        <div class="ip-lbl-side ip-lbl-right">Biology</div>
      </div>
      <div class="ip-lbl ip-lbl-bottom">Commerce</div>
    </div>`;
}

function buildReportPdfHtml({ anonymize, name, email, phone, result, headerLogoDataUri }) {
  const displayName = anonymize ? 'Student' : escapeHtml(name);
  const displayEmailPlain = anonymize ? '—' : escapeHtml(email);
  const displayPhone = anonymize ? '—' : escapeHtml(phone);
  const emailMailto = anonymize || !email ? '' : escapeHtml(String(email).trim());
  const stream = escapeHtml(result.prediction.stream);
  const conf = escapeHtml(Number(result.prediction.confidence).toFixed(2));

  const reportTitle = 'Academic Kundali';

  const categories = Object.entries(result.sections || {}).map(([title, items]) => ({
    title,
    items: items || [],
  }));
  const careersCol = renderCareerCategories(categories);
  const interestSidebar = renderInterestProfilePdfHtml(result);

  const emailMeta =
    anonymize || !email
      ? `<div class="ak-meta-cell ak-meta-center">Email: ${displayEmailPlain}</div>`
      : `<div class="ak-meta-cell ak-meta-center">Email: <a class="ak-email-link" href="mailto:${emailMailto}">${displayEmailPlain}</a></div>`;

  /* Full-width top banner: embedded logo, or text fallback if image failed on device. */
  const bannerBlock = headerLogoDataUri
    ? `<div class="ak-banner-strip"><img class="ak-banner-img" src="${headerLogoDataUri}" alt="Shree Guru Gobind Singh Tricentenary University — SGT University, NAAC A+" /></div>`
    : `<div class="ak-banner-strip ak-banner-fallback-text" role="img" aria-label="SGT University">
        <div class="ak-banner-fallback-line1">Shree Guru Gobind Singh Tricentenary University</div>
        <div class="ak-banner-fallback-line2">SGT University · NAAC A+ Accredited</div>
      </div>`;

  const reportTopSection = `
      <header class="ak-doc-header">
        ${bannerBlock}
        <div class="ak-doc-title">${reportTitle}</div>
        <div class="ak-meta-line">
          <div class="ak-meta-cell ak-meta-left">Name: ${displayName}</div>
          ${emailMeta}
          <div class="ak-meta-cell ak-meta-right">Phone: ${displayPhone}</div>
        </div>
      </header>`;

  const pageFooter = `
      <div class="footer-rule"></div>
      <div class="footer">Address: Badli Road Chandu, Budhera, Gurugram, Haryana 122505, Toll Free: 1800 102 5661</div>`;

  const titleAndMeta = `
      <div class="reco">
        <div>Recommended Stream: ${stream}</div>
        <div class="reco-line2">Confidence: ${conf}%</div>
      </div>`;

  const sectionHeading = `<div class="section-title">Suggested Career Paths</div>`;

  const pageMain = `
      ${sectionHeading}
      <div class="main-row">
        <div class="career-col">${careersCol}</div>
        <aside class="interest-col">${interestSidebar}</aside>
      </div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
  <style>
    @page { size: A4 portrait; margin: 0; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: Calibri, 'Segoe UI', Arial, sans-serif;
      color: #000000;
      line-height: 1.45;
      background: #ffffff;
    }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }

    .page {
      position: relative;
      width: 210mm;
      min-height: 297mm;
      height: auto;
      background: #ffffff;
      padding: 8mm 14mm 12mm;
    }
    .content { position: relative; display: flex; flex-direction: column; }

    .ak-doc-header { width: 100%; margin: 0 0 12px; }
    .ak-banner-strip {
      margin: -8mm -14mm 10px -14mm;
      width: calc(100% + 28mm);
      padding: 5mm 16mm 6mm;
      text-align: center;
      background: #ffffff;
      border-bottom: 1px solid #c7d2e0;
      box-sizing: border-box;
    }
    .ak-banner-fallback-text {
      padding: 4mm 10mm 5mm;
      text-align: center;
      background: #f8fafc;
    }
    .ak-banner-fallback-line1 {
      font-family: Georgia, 'Times New Roman', Times, serif;
      font-size: 9pt;
      font-weight: 700;
      color: #1e3a5f;
      line-height: 1.25;
    }
    .ak-banner-fallback-line2 {
      margin-top: 3px;
      font-size: 10pt;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: 0.04em;
    }
    .ak-banner-img {
      display: block;
      width: 100%;
      max-width: 182mm;
      height: auto;
      max-height: 28mm;
      object-fit: contain;
      object-position: center center;
      margin: 0 auto;
    }
    .ak-doc-title {
      text-align: center;
      font-family: Georgia, 'Times New Roman', Times, serif;
      font-weight: 700;
      font-size: 16pt;
      line-height: 1.25;
      color: #000000;
      margin: 0 0 10px;
    }
    .ak-meta-line {
      display: flex;
      flex-direction: row;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      font-weight: 700;
      font-size: 11pt;
      line-height: 1.4;
      color: #000000;
      width: 100%;
    }
    .ak-meta-cell { flex: 1; min-width: 0; word-wrap: break-word; }
    .ak-meta-left { text-align: left; }
    .ak-meta-center { text-align: center; }
    .ak-meta-right { text-align: right; }
    a.ak-email-link { color: #0563c1; text-decoration: underline; }

    .reco {
      text-align: center;
      font-size: 11pt;
      font-weight: 700;
      color: #000000;
      margin-bottom: 10px;
      line-height: 1.45;
    }
    .reco-line2 { margin-top: 4px; }

    .section-title {
      font-size: 11pt;
      font-weight: 700;
      color: #000000;
      margin-bottom: 6px;
    }

    .main-row {
      display: flex;
      flex-direction: row;
      align-items: flex-start;
      justify-content: space-between;
      gap: 5mm;
    }
    .career-col {
      flex: 1;
      min-width: 0;
    }
    .interest-col {
      flex-shrink: 0;
      width: 58mm;
      padding-left: 3mm;
      border-left: 1px solid #cccccc;
      color: #000000;
    }
    .ip-title {
      font-size: 10pt;
      font-weight: 700;
      margin: 0 0 6px;
      padding-bottom: 4px;
      border-bottom: 1px solid #e0e0e0;
      text-align: center;
    }
    .ip-badge {
      display: block;
      text-align: center;
      font-size: 9pt;
      font-weight: 800;
      color: #1e293b;
      padding: 6px 10px;
      margin: 0 0 10px;
      border: 1.5px solid #0d9488;
      border-radius: 999px;
      background: #f0fdfa;
      line-height: 1.3;
    }
    .ip-chart-box {
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .ip-chart-mid {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: center;
      width: 100%;
      gap: 1mm;
    }
    .ip-radar {
      display: block;
      flex: 0 0 auto;
      width: 42mm;
      max-width: 100%;
      height: auto;
    }
    .ip-lbl {
      font-size: 7.5pt;
      font-weight: 800;
      color: #334155;
      line-height: 1.15;
    }
    .ip-lbl-top { text-align: center; width: 100%; margin-bottom: 3px; }
    .ip-lbl-bottom { text-align: center; width: 100%; margin-top: 3px; }
    .ip-lbl-side {
      flex: 0 0 10mm;
      font-size: 7pt;
      font-weight: 800;
      color: #334155;
      line-height: 1.1;
    }
    .ip-lbl-left { text-align: right; padding-right: 1px; }
    .ip-lbl-right { text-align: left; padding-left: 1px; }
    .ip-na { margin: 4px 0 0; font-size: 8.5pt; color: #555555; text-align: center; }

    .career-block {
      margin-bottom: 7px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .cat-title { font-size: 11pt; font-weight: 700; color: #000000; margin-bottom: 3px; line-height: 1.35; }
    ul.bullets { margin: 0; padding-left: 18px; }
    ul.bullets li { margin: 2px 0; font-size: 11pt; color: #000000; line-height: 1.45; }

    .footer-rule {
      margin-top: 8mm;
      height: 1px;
      background: #cccccc;
      margin-bottom: 6px;
    }
    .footer {
      font-size: 9pt;
      color: #404040;
      line-height: 1.45;
      text-align: center;
    }
  </style></head><body>
  <div class="page">
    <div class="content">
      ${reportTopSection}
      ${titleAndMeta}
      ${pageMain}
      ${pageFooter}
    </div>
  </div>
  </body></html>`;
}

/** Basic email format check (common local-part@domain.tld). */
function isValidEmail(email) {
  const t = email.trim();
  if (t.length < 5 || t.length > 254) return false;
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(t);
}

/**
 * Phone: +91 / optional leading 0 for Indian mobile; 10-digit national numbers;
 * 8–15 digits after stripping non-digits for other countries.
 */
function isValidPhone(phone) {
  const cleaned = phone.trim().replace(/[\s\-.()]/g, '');
  if (!cleaned) return false;
  let digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  digits = digits.replace(/\D/g, '');
  if (!digits.length) return false;

  if (digits.length === 12 && digits.startsWith('91')) {
    return /^91[6-9]\d{9}$/.test(digits);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return /^0[6-9]\d{9}$/.test(digits);
  }
  if (digits.length === 10) {
    return /^[1-9]\d{9}$/.test(digits);
  }
  return digits.length >= 8 && digits.length <= 15;
}

function SubjectRow({ label, value, onChange }) {
  return (
    <View style={styles.subjectRow}>
      <View style={styles.subjectHeader}>
        <Text style={styles.subjectLabel}>{label}</Text>
        <Text style={styles.subjectValue}>{Math.round(value)}</Text>
      </View>
      <Slider
        style={styles.slider}
        minimumValue={1}
        maximumValue={5}
        step={1}
        value={value}
        onValueChange={onChange}
        minimumTrackTintColor="#4facfe"
        maximumTrackTintColor="#e2e8f0"
        thumbTintColor="#00a8cc"
      />
    </View>
  );
}

function YesNoRow({ label, value, onChange }) {
  return (
    <View style={styles.yesNoRow}>
      <Text style={styles.subjectLabel}>{label}</Text>
      <View style={styles.yesNoBtns}>
        {['No', 'Yes'].map((opt) => {
          const active = (opt === 'Yes') === value;
          return (
            <Pressable
              key={opt}
              onPress={() => onChange(opt === 'Yes')}
              style={[styles.yesNoChip, active && styles.yesNoChipActive]}
            >
              <Text style={[styles.yesNoText, active && styles.yesNoTextActive]}>{opt}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

class ReportErrorBoundary extends Component {
  state = { hasError: false, errorMsg: '' };

  static getDerivedStateFromError(error) {
    return { hasError: true, errorMsg: error?.message || String(error) };
  }

  componentDidCatch(error, info) {
    console.warn('[Academic Kundali] ErrorBoundary caught:', error, info?.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Text style={{ fontSize: 18, fontWeight: '700', color: '#ef4444', marginBottom: 12, textAlign: 'center' }}>
            Something went wrong
          </Text>
          <Text style={{ fontSize: 13, color: '#64748b', textAlign: 'center', marginBottom: 20 }}>
            {this.state.errorMsg}
          </Text>
          <Pressable
            onPress={() => this.setState({ hasError: false, errorMsg: '' })}
            style={{ backgroundColor: '#4facfe', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 15 }}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const systemScheme = useColorScheme();
  const [studentName, setStudentName] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
  const [studentPhone, setStudentPhone] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [page, setPage] = useState('login'); // 'login' | 'questions' | 'report'
  const [settings, setSettings] = useState({
    notifications: true,
    shareAnonymously: false,
    darkMode: false,
  });

  const [math, setMath] = useState(3);
  const [physics, setPhysics] = useState(3);
  const [chemistry, setChemistry] = useState(3);
  const [biology, setBiology] = useState(3);
  const [economics, setEconomics] = useState(3);
  const [businessInterest, setBusinessInterest] = useState(3);
  const [history, setHistory] = useState(3);
  const [numerical, setNumerical] = useState(3);

  const [doctor, setDoctor] = useState(false);
  const [engineer, setEngineer] = useState(false);

  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  /** Defer QR mount until after transitions — avoids native crashes on some Android builds. */
  const [qrReady, setQrReady] = useState(false);
  const [qrFailed, setQrFailed] = useState(false);

  const logout = () => {
    setStudentName('');
    setStudentEmail('');
    setStudentPhone('');
    setError('');
    setResult(null);
    setMath(3);
    setPhysics(3);
    setChemistry(3);
    setBiology(3);
    setEconomics(3);
    setBusinessInterest(3);
    setHistory(3);
    setNumerical(3);
    setDoctor(false);
    setEngineer(false);
    setPage('login');
    setMenuOpen(false);
  };

  const continueToQuestions = () => {
    setError('');
    if (!studentName.trim() || !studentEmail.trim() || !studentPhone.trim()) {
      setError('Please fill Name, Email and Phone to continue.');
      return;
    }
    if (!isValidEmail(studentEmail)) {
      setError('Please enter a valid email address (e.g. name@example.com).');
      return;
    }
    if (!isValidPhone(studentPhone)) {
      setError(
        'Please enter a valid phone number. Examples: 10-digit mobile, +91 9XXXXXXXXX, or 8–15 digits with country code.',
      );
      return;
    }
    setPage('questions');
  };

  const applyResultFromLink = (url) => {
    if (!url) return;
    const parsed = Linking.parse(url);
    const path = (parsed.path || '').replace(/^\/+/, '');
    if (path !== 'result') return;

    const q = parsed.queryParams || {};
    const streamRaw = typeof q.s === 'string' ? q.s : '';
    const stream = normalizeStreamFromDeepLink(streamRaw);
    const confidenceNum = Number(q.c);
    if (!stream || !Number.isFinite(confidenceNum)) return;

    // Minimal result from link (careers still load from CAREER_MAP).
    const prediction = { stream, confidence: confidenceNum, method: 'rule', rule: 'qr' };
    const sections = CAREER_MAP[stream] || {};
    setResult({
      prediction,
      scores: null,
      radar: null,
      sections,
      studentName: typeof q.n === 'string' ? q.n : '',
      studentEmail: typeof q.e === 'string' ? q.e : '',
      studentPhone: typeof q.p === 'string' ? q.p : '',
    });
    setError('');
    setPage('report');
  };

  useEffect(() => {
    let sub;
    (async () => {
      const initial = await Linking.getInitialURL();
      applyResultFromLink(initial);
      sub = Linking.addEventListener('url', ({ url }) => applyResultFromLink(url));
    })();
    return () => {
      sub?.remove?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (page !== 'report' || !result) {
      setQrReady(false);
      setQrFailed(false);
      return;
    }
    const task = InteractionManager.runAfterInteractions(() => setQrReady(true));
    return () => {
      task?.cancel?.();
      setQrReady(false);
    };
  }, [page, result]);

  const inputs = {
    math,
    physics,
    chemistry,
    biology,
    economics,
    business_interest: businessInterest,
    history,
    numerical,
    doctor,
    engineer,
  };

  const generateReport = () => {
    setError('');
    if (!studentName.trim() || !studentEmail.trim() || !studentPhone.trim()) {
      setError('Please complete your profile (Name, Email, Phone) first.');
      setResult(null);
      setPage('login');
      return;
    }

    try {
      const scores = computeScores(inputs);
      const prediction = predictStream(inputs);
      const radar = normalizedRadarValues(scores);
      const sections = CAREER_MAP[prediction.stream] || {};

      setResult({
        prediction,
        scores,
        radar,
        sections,
        studentName: studentName.trim(),
        studentEmail: studentEmail.trim(),
        studentPhone: studentPhone.trim(),
      });
      setPage('report');

      const db = supabase;
      if (db) {
        void (async () => {
          try {
            const { error: dbErr } = await db.from('students').insert({
              name: studentName.trim(),
              email: studentEmail.trim(),
              phone: studentPhone.trim(),
              maths: math,
              physics,
              chemistry,
              biology,
              recommended_stream: prediction.stream,
              confidence: prediction.confidence,
            });
            if (dbErr) throw dbErr;
          } catch (e) {
            Alert.alert('Could not save to database', e?.message ?? String(e));
          }
        })();
      }
    } catch (e) {
      console.warn('[Academic Kundali] generateReport error:', e);
      setError('Could not generate report: ' + (e?.message || String(e)));
    }
  };

  const shareReport = async () => {
    if (!result) return;
    const { prediction, studentName: n, studentEmail: e, studentPhone: ph } = result;
    const nameLine = settings.shareAnonymously ? 'Academic Kundali — Student' : `Academic Kundali — ${n}`;
    const contactLine = settings.shareAnonymously ? '' : `Email: ${e}  Phone: ${ph}`;
    const lines = [
      nameLine,
      contactLine,
      '',
      `Recommended stream: ${prediction.stream}`,
      `Confidence: ${prediction.confidence.toFixed(2)}%`,
      prediction.method === 'rule' ? `(Rule: ${prediction.rule || 'override'})` : '(Score-based)',
    ];
    if (qrValue.trim()) {
      lines.push('', 'Link (same as QR code):', qrValue.trim());
    }
    try {
      await Share.share({
        message: lines.filter(Boolean).join('\n'),
        title: 'Academic Kundali',
      });
    } catch {
      /* ignore */
    }
  };

  const qrValue = useMemo(() => {
    if (!result) return '';
    const { prediction, studentName: n, studentEmail: e, studentPhone: ph } = result;
    const qp = {
      s: prediction.stream,
      c: Number(prediction.confidence).toFixed(2),
    };
    if (!settings.shareAnonymously) {
      if (n) qp.n = n;
      if (e) qp.e = e;
      if (ph) qp.p = ph;
    }
    // createURL can throw in release if the embedded manifest has no scheme — crashes the screen.
    // QR encoder can throw if the string exceeds max capacity — handle via try/catch + onError on QRCode.
    try {
      return Linking.createURL('result', { queryParams: qp });
    } catch (e1) {
      try {
        return Linking.createURL('result', {
          queryParams: { s: qp.s, c: qp.c },
        });
      } catch (e2) {
        console.warn('[Academic Kundali] createURL failed', e1?.message ?? e1, e2?.message ?? e2);
        return '';
      }
    }
  }, [result, settings.shareAnonymously]);

  /** Shorter payload if the full link is too large for a single QR (byte mode ~2.9k). */
  const qrCodeString = useMemo(() => {
    if (!result) return ' ';
    const full = qrValue.trim();
    if (!full) return ' ';
    if (full.length < 2400) return full;
    try {
      const { prediction } = result;
      return Linking.createURL('result', {
        queryParams: {
          s: prediction.stream,
          c: Number(prediction.confidence).toFixed(2),
        },
      });
    } catch {
      return full;
    }
  }, [result, qrValue]);

  const downloadReport = async () => {
    if (!result) return;
    setDownloadingPdf(true);
    try {
      // Web: open print dialog (user can "Save as PDF").
      if (Platform.OS === 'web') {
        const headerLogoDataUri = await assetToDataUri(PDF_REPORT_BANNER, 'image/jpeg');
        console.log('[Academic Kundali PDF] banner (web)', {
          nonEmpty: Boolean(headerLogoDataUri),
          length: headerLogoDataUri?.length ?? 0,
          prefix: headerLogoDataUri?.slice(0, 42) ?? '',
        });
        const html = buildReportPdfHtml({
          anonymize: settings.shareAnonymously,
          name: studentName.trim() || result.studentName || '',
          email: studentEmail.trim() || result.studentEmail || '',
          phone: studentPhone.trim() || result.studentPhone || '',
          result,
          headerLogoDataUri,
        });
        await Print.printAsync({ html });
        return;
      }

      const headerLogoDataUri = await assetToDataUri(PDF_REPORT_BANNER, 'image/jpeg');
      const resolved = Image.resolveAssetSource(PDF_REPORT_BANNER);
      console.log('[Academic Kundali PDF] banner (native)', {
        nonEmpty: Boolean(headerLogoDataUri),
        length: headerLogoDataUri?.length ?? 0,
        prefix: headerLogoDataUri?.slice(0, 42) ?? '',
        resolveUri: resolved?.uri ? String(resolved.uri).slice(0, 80) : null,
      });
      if (!headerLogoDataUri) {
        console.warn('[Academic Kundali PDF] banner image empty — using text header fallback in HTML');
      }
      const html = buildReportPdfHtml({
        anonymize: settings.shareAnonymously,
        name: studentName.trim() || result.studentName || '',
        email: studentEmail.trim() || result.studentEmail || '',
        phone: studentPhone.trim() || result.studentPhone || '',
        result,
        headerLogoDataUri,
      });
      if (__DEV__ && headerLogoDataUri) {
        const imgMatch = html.match(/<img class="ak-banner-img"[^>]*src="([^"]*)"/);
        console.log('[Academic Kundali PDF] HTML img src non-empty:', Boolean(imgMatch?.[1]?.length));
      }
      const { uri } = await Print.printToFileAsync({ html });

      // Give the file a real name so "Save to Files/Drive" looks clean.
      const safeName = settings.shareAnonymously ? 'Student' : sanitizeFilenamePart(studentName.trim() || result.studentName || 'Student');
      const d = new Date();
      const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const fileName = `Academic_Kundali_Report_${safeName}_${stamp}.pdf`;
      let shareUri = uri;

      // iOS is picky about sharing file URIs; only share the renamed file if it truly exists.
      try {
        const baseDir = FileSystem.documentDirectory || FileSystem.cacheDirectory;
        if (baseDir) {
          const reportsDir = `${baseDir}reports/`;
          await FileSystem.makeDirectoryAsync(reportsDir, { intermediates: true }).catch(() => {});
          const destUri = `${reportsDir}${fileName}`;
          await FileSystem.copyAsync({ from: uri, to: destUri });
          const info = await FileSystem.getInfoAsync(destUri);
          if (info?.exists) shareUri = destUri;
        }
      } catch {
        // Keep shareUri as the original Print uri.
      }

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Saved', 'PDF was created. If it did not open automatically, check your Downloads/Files app.');
        try {
          await Linking.openURL(shareUri);
        } catch {
          // ignore
        }
        return;
      }
      await Sharing.shareAsync(shareUri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Academic Kundali report',
        UTI: 'com.adobe.pdf',
      });
    } catch (e) {
      Alert.alert('Could not create PDF', String(e?.message || e));
    } finally {
      setDownloadingPdf(false);
    }
  };

  const isDark = settings.darkMode || systemScheme === 'dark';
  const theme = useMemo(() => {
    if (isDark) {
      return {
        bg: '#0b1220',
        card: '#0f172a',
        text: '#e5e7eb',
        muted: '#94a3b8',
        border: '#1f2937',
        inputBg: '#0b1220',
        chipBg: '#111827',
        overlay: 'rgba(0,0,0,0.55)',
        header: '#1d4ed8',
        headerBtnBg: 'rgba(255,255,255,0.18)',
        danger: '#ef4444',
      };
    }
    return {
      bg: '#f4f6f7',
      card: '#ffffff',
      text: '#0f172a',
      muted: '#64748b',
      border: '#e2e8f0',
      inputBg: '#fafafa',
      chipBg: '#f4f6f7',
      overlay: 'rgba(15, 23, 42, 0.35)',
      header: '#4facfe',
      headerBtnBg: 'rgba(255,255,255,0.20)',
      danger: '#ef4444',
    };
  }, [isDark]);

  return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top', 'left', 'right']}>
        <KeyboardAvoidingView
          style={[styles.root, { backgroundColor: theme.bg }]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <StatusBar style={isDark ? 'light' : 'dark'} />
      <Modal
        visible={menuOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuOpen(false)}
        statusBarTranslucent
      >
        <View style={styles.drawerOverlay}>
          <Pressable style={[styles.drawerBackdrop, { backgroundColor: theme.overlay }]} onPress={() => setMenuOpen(false)} />
          <View
            style={[
              styles.drawer,
              {
                paddingTop: Math.max(insets.top, 12),
                paddingBottom: Math.max(insets.bottom, 12),
                paddingRight: Math.max(insets.right, 0),
                backgroundColor: theme.card,
              },
            ]}
          >
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.drawerScrollContent}
            >
              <View style={styles.drawerHeader}>
                <Text style={[styles.drawerTitle, { color: theme.text }]}>Settings</Text>
                <Pressable
                  onPress={() => setMenuOpen(false)}
                  style={styles.drawerCloseBtn}
                  accessibilityLabel="Close settings"
                  hitSlop={10}
                >
                  <Text style={[styles.drawerCloseText, { color: theme.text }]}>✕</Text>
                </Pressable>
              </View>

              <Text style={[styles.drawerSectionTitle, { color: theme.muted }]}>Profile</Text>
              <View style={[styles.profileCard, { backgroundColor: theme.inputBg, borderColor: theme.border }]}>
                <Text style={[styles.profileLine, { color: theme.text }]}>
                  <Text style={[styles.profileLabel, { color: theme.muted }]}>Name: </Text>
                  {studentName.trim() || '—'}
                </Text>
                <Text style={[styles.profileLine, { color: theme.text }]}>
                  <Text style={[styles.profileLabel, { color: theme.muted }]}>Email: </Text>
                  {studentEmail.trim() || '—'}
                </Text>
                <Text style={[styles.profileLine, { color: theme.text }]}>
                  <Text style={[styles.profileLabel, { color: theme.muted }]}>Phone: </Text>
                  {studentPhone.trim() || '—'}
                </Text>
              </View>

              <Text style={[styles.drawerSectionTitle, { color: theme.muted }]}>App settings</Text>
              <View style={[styles.settingRow, { borderBottomColor: theme.border }]}>
                <View style={styles.settingTextWrap}>
                  <Text style={[styles.settingTitle, { color: theme.text }]}>Notifications</Text>
                  <Text style={[styles.settingSub, { color: theme.muted }]}>Show guidance reminders (UI only)</Text>
                </View>
                <Switch
                  value={settings.notifications}
                  onValueChange={(v) => setSettings((s) => ({ ...s, notifications: v }))}
                />
              </View>
              <View style={[styles.settingRow, { borderBottomColor: theme.border }]}>
                <View style={styles.settingTextWrap}>
                  <Text style={[styles.settingTitle, { color: theme.text }]}>Share anonymously</Text>
                  <Text style={[styles.settingSub, { color: theme.muted }]}>Hide name/email/phone when sharing</Text>
                </View>
                <Switch
                  value={settings.shareAnonymously}
                  onValueChange={(v) => setSettings((s) => ({ ...s, shareAnonymously: v }))}
                />
              </View>
              <View style={[styles.settingRow, { borderBottomColor: theme.border }]}>
                <View style={styles.settingTextWrap}>
                  <Text style={[styles.settingTitle, { color: theme.text }]}>Dark mode</Text>
                  <Text style={[styles.settingSub, { color: theme.muted }]}>Enable dark theme</Text>
                </View>
                <Switch
                  value={settings.darkMode}
                  onValueChange={(v) => setSettings((s) => ({ ...s, darkMode: v }))}
                />
              </View>

              <View style={styles.drawerFooter}>
                <Pressable style={[styles.logoutBtn, { backgroundColor: theme.danger }]} onPress={logout}>
                  <Text style={styles.logoutBtnText}>Log out</Text>
                </Pressable>
                <Text style={[styles.logoutHint, { color: theme.muted }]}>
                  Logout clears your profile fields and resets the questionnaire on this device.
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.topBannerWrap, { backgroundColor: theme.card }]}>
          <Image
            source={require('./assets/sgt-app-top-banner.jpg')}
            style={styles.topBannerImage}
            resizeMode="contain"
            accessibilityLabel="SGT University — Shree Guru Gobind Singh Tricentenary University, NAAC A+"
          />
        </View>
        <View style={[styles.headerBanner, { backgroundColor: theme.header }]}>
          <View style={styles.headerTopRow}>
            <View style={styles.headerTopSpacer} />
            <Pressable
              style={[styles.menuBtn, { backgroundColor: theme.headerBtnBg }]}
              onPress={() => setMenuOpen(true)}
              accessibilityLabel="Open menu"
              hitSlop={14}
            >
              <Text style={styles.menuBtnText}>⋮</Text>
            </Pressable>
          </View>
          <Text style={styles.headerTitle}>Academic Kundali</Text>
          <Text style={styles.headerSub}>
            {page === 'login'
              ? 'Login with your details to continue.'
              : page === 'questions'
                ? 'Answer questions and generate your report.'
                : 'Your report is ready.'}
          </Text>
        </View>

        {page === 'login' ? (
          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <Text style={styles.sectionTitle}>Login / Student information</Text>
            <Text style={styles.label}>Full name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
              placeholder="Full name"
              placeholderTextColor="#94a3b8"
              value={studentName}
              onChangeText={setStudentName}
            />
            <Text style={[styles.label, styles.labelSpaced]}>Email</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
              placeholder="Email"
              placeholderTextColor="#94a3b8"
              value={studentEmail}
              onChangeText={setStudentEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Text style={[styles.label, styles.labelSpaced]}>Phone</Text>
            <TextInput
              style={[styles.input, { backgroundColor: theme.inputBg, borderColor: theme.border, color: theme.text }]}
              placeholder="Phone"
              placeholderTextColor="#94a3b8"
              value={studentPhone}
              onChangeText={setStudentPhone}
              keyboardType="phone-pad"
            />

            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
              onPress={continueToQuestions}
            >
              <Text style={styles.primaryBtnText}>Continue</Text>
            </Pressable>
          </View>
 ) : page === 'questions' ? (
          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <View style={styles.pageTopRow}>
              <Text style={styles.sectionTitle}>Questions</Text>
              <Pressable style={styles.linkBtn} onPress={() => setPage('login')}>
                <Text style={styles.linkBtnText}>Edit profile</Text>
              </Pressable>
            </View>

            <Text style={[styles.smallMuted, { color: theme.muted }]}>
              Student: {studentName.trim() || '—'}
              {settings.shareAnonymously ? '' : ` · ${studentEmail.trim() || '—'}`}
            </Text>

            <Text style={[styles.label, { marginTop: 12 }]}>Student interests (1 = low, 5 = strong)</Text>
            <SubjectRow label="Interest in Mathematics" value={math} onChange={setMath} />
            <SubjectRow label="Interest in Physics" value={physics} onChange={setPhysics} />
            <SubjectRow label="Interest in Chemistry" value={chemistry} onChange={setChemistry} />
            <SubjectRow label="Interest in Biology" value={biology} onChange={setBiology} />
            <SubjectRow label="Interest in Economics" value={economics} onChange={setEconomics} />
            <SubjectRow
              label="Interest in business / financial topics"
              value={businessInterest}
              onChange={setBusinessInterest}
            />
            <SubjectRow label="Interest in History" value={history} onChange={setHistory} />
            <SubjectRow
              label="Interest in solving numerical problems"
              value={numerical}
              onChange={setNumerical}
            />

            <YesNoRow label="Want to become a Doctor?" value={doctor} onChange={setDoctor} />
            <YesNoRow label="Want to become an Engineer?" value={engineer} onChange={setEngineer} />

            <Pressable
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
              onPress={generateReport}
            >
              <Text style={styles.primaryBtnText}>Generate report</Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.card, { backgroundColor: theme.card }]}>
            <View style={styles.pageTopRow}>
              <Text style={styles.sectionTitle}>Report</Text>
              <Pressable style={styles.linkBtn} onPress={logout}>
                <Text style={styles.linkBtnText}>Log out</Text>
              </Pressable>
            </View>

            {!result ? (
              <Text style={styles.errorText}>No report found. Please generate a report first.</Text>
            ) : (
              <>
                <View style={styles.successBanner}>
                  <Text style={styles.successTitle}>Recommended stream</Text>
                  <Text style={styles.successStream}>{result.prediction.stream}</Text>
                  <Text style={styles.confidence}>
                    Confidence: {Number(result.prediction.confidence).toFixed(2)}%
                  </Text>
                </View>

                {result.radar && result.scores ? (
                  <>
                    <Text style={styles.chartTitle}>Interest profile</Text>
                    <RadarChart
                      stem={result.radar.STEM}
                      biology={result.radar.Biology}
                      commerce={result.radar.Commerce}
                      arts={result.radar.Arts}
                      dark={isDark}
                      highlight={
                        result.prediction.stream === 'Science & Engineering'
                          ? 'STEM'
                          : result.prediction.stream === 'Science (Biology)'
                            ? 'Biology'
                            : result.prediction.stream === 'Commerce'
                              ? 'Commerce'
                              : result.prediction.stream === 'Arts'
                                ? 'Arts'
                                : undefined
                      }
                      highlightPercent={Number(result.prediction.confidence).toFixed(0)}
                    />
                    <Text style={styles.scoreLine}>
                      STEM: {result.scores.stem_score} · Biology: {result.scores.bio_score} · Commerce:{' '}
                      {result.scores.commerce_score} · Arts: {result.scores.arts_score}
                    </Text>
                  </>
                ) : null}

                <Text style={styles.suggestedTitle}>Suggested careers</Text>
                {Object.entries(result.sections).map(([section, careers]) => (
                  <View key={section} style={styles.careerSection}>
                    <Text style={styles.careerSectionTitle}>{section}</Text>
                    {careers.map((c) => (
                      <View key={c} style={styles.careerChip}>
                        <Text style={styles.careerChipText}>{c}</Text>
                      </View>
                    ))}
                  </View>
                ))}

                <Pressable style={styles.secondaryBtn} onPress={shareReport}>
                  <Text style={styles.secondaryBtnText}>Share summary</Text>
                </Pressable>

                <View style={styles.qrWrap}>
                  <Text style={styles.qrTitle}>Share link (QR)</Text>
                  <Text style={styles.qrSub}>
                    Scan this code — it matches the link included when you tap Share summary above.
                  </Text>
                  {qrValue && qrCodeString !== qrValue ? (
                    <Text style={[styles.smallMuted, { color: theme.muted, marginBottom: 8 }]}>
                      QR uses a shorter link (stream + confidence) so it scans reliably; the full link is shown
                      below.
                    </Text>
                  ) : null}
                  <View style={styles.qrBox}>
                    {!qrReady ? (
                      <ActivityIndicator size="large" color="#0f172a" />
                    ) : qrFailed ? (
                      <Text style={styles.errorText}>Could not generate QR. Use Share summary instead.</Text>
                    ) : (
                      <QRCode
                        value={qrCodeString || ' '}
                        size={170}
                        backgroundColor="#ffffff"
                        color="#0f172a"
                        ecl="L"
                        onError={() => setQrFailed(true)}
                      />
                    )}
                  </View>
                  <Text style={styles.qrLink} numberOfLines={3}>
                    {qrValue || '—'}
                  </Text>
                  <Text style={styles.qrHint}>
                    Tip: Turn on “Share anonymously” in Settings to hide name/email/phone in the link and QR.
                  </Text>
                </View>
              </>
            )}

            <View style={styles.navRow}>
              <Pressable
                style={[
                  styles.navBtn,
                  { borderColor: theme.border, backgroundColor: theme.chipBg },
                  !result && { flex: 1 },
                ]}
                onPress={() => setPage('questions')}
              >
                <Text style={[styles.navBtnText, { color: theme.text }]}>Back</Text>
              </Pressable>
              {result ? (
                <Pressable
                  style={[styles.downloadBtn, downloadingPdf && styles.downloadBtnBusy]}
                  onPress={downloadReport}
                  disabled={downloadingPdf}
                >
                  {downloadingPdf ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.downloadBtnText}>Download report</Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          </View>
        )}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Text style={styles.footerAddr}>
          Gurgaon-Badli Road Chandu, Budhera, Gurugram, Haryana 122505
        </Text>
      </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ReportErrorBoundary>
        <AppContent />
      </ReportErrorBoundary>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f4f6f7' },
  root: { flex: 1, backgroundColor: '#f4f6f7' },
  scroll: { padding: 16, paddingBottom: 40 },
  drawerOverlay: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: 'transparent',
  },
  drawerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  drawer: {
    width: 320,
    maxWidth: '85%',
    backgroundColor: '#fff',
    paddingLeft: 16,
    shadowColor: '#000',
    shadowOffset: { width: -2, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 8,
  },
  drawerScrollContent: {
    paddingRight: 16,
    paddingBottom: 8,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  drawerTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  drawerCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
  },
  drawerCloseText: { fontSize: 16, color: '#0f172a', fontWeight: '700' },
  drawerSectionTitle: { marginTop: 10, marginBottom: 8, fontSize: 13, fontWeight: '800', color: '#334155' },
  profileCard: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fafafa',
  },
  profileLine: { fontSize: 14, color: '#0f172a', marginBottom: 6 },
  profileLabel: { fontWeight: '800', color: '#334155' },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  settingTextWrap: { flex: 1, paddingRight: 12 },
  settingTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  settingSub: { fontSize: 12, color: '#64748b', marginTop: 2 },
  drawerFooter: { marginTop: 18 },
  logoutBtn: {
    backgroundColor: '#ef4444',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  logoutBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  logoutHint: { fontSize: 11, color: '#64748b', lineHeight: 16, marginTop: 10 },
  topBannerWrap: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 12,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  topBannerImage: {
    width: '100%',
    height: 136,
    maxWidth: 560,
  },
  headerBanner: {
    backgroundColor: '#4facfe',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    overflow: 'hidden',
  },
  headerTopRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: -6,
    marginRight: -6,
    marginBottom: 2,
  },
  headerTopSpacer: { flex: 1 },
  menuBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBtnText: { color: '#fff', fontSize: 20, fontWeight: '900', marginTop: -2 },
  headerTitle: { fontSize: 26, fontWeight: '800', color: '#fff' },
  headerSub: { fontSize: 14, color: 'rgba(255,255,255,0.95)', marginTop: 8, lineHeight: 20 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#1e293b', marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '600', color: '#475569' },
  labelSpaced: { marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#0f172a',
    marginTop: 6,
    backgroundColor: '#fafafa',
  },
  multiline: { minHeight: 100, paddingTop: 12 },
  subjectRow: { marginTop: 14 },
  subjectHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  subjectLabel: { fontSize: 14, fontWeight: '600', color: '#334155', flex: 1, paddingRight: 8 },
  subjectValue: { fontSize: 14, fontWeight: '700', color: '#0284c7' },
  slider: { width: '100%', height: 40 },
  yesNoRow: { marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  yesNoBtns: { flexDirection: 'row', gap: 8 },
  yesNoChip: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
  },
  yesNoChipActive: { backgroundColor: '#e0f2fe', borderColor: '#4facfe' },
  yesNoText: { fontSize: 14, color: '#64748b', fontWeight: '600' },
  yesNoTextActive: { color: '#0369a1' },
  primaryBtn: {
    backgroundColor: '#00c6ff',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  primaryBtnPressed: { opacity: 0.92 },
  primaryBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  navRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  navBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
  },
  navBtnText: { fontSize: 14, fontWeight: '800' },
  downloadBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0d9488',
  },
  downloadBtnBusy: { opacity: 0.85 },
  downloadBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  pageTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  linkBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
  },
  linkBtnText: { color: '#0284c7', fontWeight: '800', fontSize: 12 },
  smallMuted: { marginTop: 6, fontSize: 12, color: '#64748b' },
  errorText: { color: '#dc2626', marginBottom: 8, fontSize: 14 },
  successBanner: {
    backgroundColor: '#ecfdf5',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#a7f3d0',
    marginBottom: 16,
  },
  successTitle: { fontSize: 14, fontWeight: '600', color: '#047857' },
  successStream: { fontSize: 22, fontWeight: '800', color: '#065f46', marginTop: 4 },
  confidence: { fontSize: 16, fontWeight: '600', color: '#0f766e', marginTop: 8 },
  methodHint: { fontSize: 12, color: '#6b7280', marginTop: 8, lineHeight: 18 },
  chartTitle: { fontSize: 17, fontWeight: '700', color: '#1e293b', marginBottom: 4 },
  scoreLine: { fontSize: 12, color: '#64748b', textAlign: 'center', marginBottom: 8 },
  suggestedTitle: { fontSize: 17, fontWeight: '700', color: '#1e293b', marginTop: 8, marginBottom: 12 },
  qrWrap: {
    marginTop: 10,
    marginBottom: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  qrTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  qrSub: { fontSize: 12, color: '#64748b', marginTop: 4 },
  qrBox: {
    marginTop: 12,
    alignSelf: 'center',
    padding: 12,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  qrHint: { marginTop: 10, fontSize: 11, color: '#64748b', lineHeight: 16 },
  qrLink: { marginTop: 10, fontSize: 11, color: '#0ea5e9', textAlign: 'center' },
  careerSection: { marginBottom: 16 },
  careerSectionTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  careerChip: {
    backgroundColor: '#f4f6f7',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  careerChipText: { fontSize: 14, color: '#334155' },
  secondaryBtn: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4facfe',
  },
  secondaryBtnText: { color: '#0284c7', fontWeight: '700', fontSize: 16 },
  footerAddr: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 8, lineHeight: 16 },
});

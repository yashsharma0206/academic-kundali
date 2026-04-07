import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polygon, Line, Circle } from 'react-native-svg';

/**
 * Four-axis radar (STEM, Biology, Commerce, Arts) — values 0–1.
 * Axes: top, right, bottom, left.
 * Recommended axis: teal border + fill + label text with inline ✓ and confidence (no floating arrows).
 */
export default function RadarChart({
  stem,
  biology,
  commerce,
  arts,
  size = 220,
  highlight, // 'STEM' | 'Biology' | 'Commerce' | 'Arts'
  highlightPercent,
  dark = false,
  labels = {
    STEM: 'Science & Engineering',
    Biology: 'Biology',
    Commerce: 'Commerce',
    Arts: 'Arts',
  },
}) {
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.38;
  const vals = [stem, biology, commerce, arts];

  const pctStr =
    highlightPercent != null && highlightPercent !== ''
      ? String(highlightPercent).replace(/%/g, '')
      : null;

  const isRecommended = (axisKey) => Boolean(highlight && pctStr && highlight === axisKey);

  function labelText(axisKey, base) {
    if (!isRecommended(axisKey)) return base;
    return `${base} · ${pctStr}%`;
  }

  function point(i, scale) {
    const r = R * scale;
    switch (i) {
      case 0:
        return { x: cx, y: cy - r };
      case 1:
        return { x: cx + r, y: cy };
      case 2:
        return { x: cx, y: cy + r };
      case 3:
        return { x: cx - r, y: cy };
      default:
        return { x: cx, y: cy };
    }
  }

  const grid = [0.25, 0.5, 0.75, 1].map((g) => {
    const pts = [0, 1, 2, 3].map((i) => point(i, g));
    return `${pts.map((p) => `${p.x},${p.y}`).join(' ')}`;
  });

  const polyPts = [0, 1, 2, 3].map((i) => point(i, Math.min(1, Math.max(0, vals[i]))));
  const polyStr = polyPts.map((p) => `${p.x},${p.y}`).join(' ');

  const axisLines = [0, 1, 2, 3].map((i) => {
    const end = point(i, 1);
    return (
      <Line
        key={i}
        x1={cx}
        y1={cy}
        x2={end.x}
        y2={end.y}
        stroke={dark ? '#334155' : '#e2e8f0'}
        strokeWidth="1"
      />
    );
  });

  const gridStroke = dark ? '#1f2937' : '#f1f5f9';
  const centerFill = dark ? '#64748b' : '#94a3b8';

  const pillStyle = (axisKey) => [
    styles.pill,
    dark ? styles.pillDark : null,
    isRecommended(axisKey) ? styles.pillRecommended : null,
    isRecommended(axisKey) && dark ? styles.pillRecommendedOnDark : null,
  ];

  const textBase = [styles.pillText, dark && styles.pillTextDark];

  const markStyle = [styles.recommendMark, dark && styles.recommendMarkDark];

  return (
    <View style={styles.wrap}>
      <View style={{ width: size, height: size, position: 'relative' }}>
        <Svg width={size} height={size}>
          {grid.map((pts, idx) => (
            <Polygon key={idx} points={pts} fill="none" stroke={gridStroke} strokeWidth="1" />
          ))}
          {axisLines}
          <Circle cx={cx} cy={cy} r="3" fill={centerFill} />
          <Polygon points={polyStr} fill="rgba(13,148,136,0.25)" stroke="#0d9488" strokeWidth="2" />
        </Svg>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View style={[pillStyle('STEM'), styles.axisTop, styles.rowCenter]}>
            <Text style={[...textBase, styles.pillTextCenter]} numberOfLines={2}>
              {labelText('STEM', labels.STEM)}
            </Text>
            {isRecommended('STEM') ? (
              <Text style={markStyle} accessibilityLabel="Recommended">
                {' '}
                ✓
              </Text>
            ) : null}
          </View>
          <View style={[pillStyle('Biology'), styles.axisRight, styles.rowEnd]}>
            <Text style={[...textBase, styles.pillTextRight]} numberOfLines={2}>
              {labelText('Biology', labels.Biology)}
            </Text>
            {isRecommended('Biology') ? (
              <Text style={markStyle} accessibilityLabel="Recommended">
                {' '}
                ✓
              </Text>
            ) : null}
          </View>
          <View style={[pillStyle('Commerce'), styles.axisBottom, styles.rowCenter]}>
            <Text style={[...textBase, styles.pillTextCenter]} numberOfLines={2}>
              {labelText('Commerce', labels.Commerce)}
            </Text>
            {isRecommended('Commerce') ? (
              <Text style={markStyle} accessibilityLabel="Recommended">
                {' '}
                ✓
              </Text>
            ) : null}
          </View>
          <View style={[pillStyle('Arts'), styles.axisLeft, styles.rowStart]}>
            <Text style={[...textBase, styles.pillTextLeft]} numberOfLines={2}>
              {labelText('Arts', labels.Arts)}
            </Text>
            {isRecommended('Arts') ? (
              <Text style={markStyle} accessibilityLabel="Recommended">
                {' '}
                ✓
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', marginVertical: 12, position: 'relative' },
  pill: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(148,163,184,0.45)',
    maxWidth: '78%',
  },
  pillDark: {
    backgroundColor: 'rgba(15,23,42,0.92)',
    borderColor: 'rgba(71,85,105,0.55)',
  },
  pillRecommended: {
    borderWidth: 2,
    borderColor: '#0d9488',
    backgroundColor: 'rgba(240,253,250,0.98)',
  },
  pillRecommendedOnDark: {
    borderColor: '#2dd4bf',
    backgroundColor: 'rgba(6,78,59,0.5)',
  },
  pillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#334155',
    flexShrink: 1,
  },
  pillTextDark: {
    color: '#e5e7eb',
  },
  pillTextCenter: { textAlign: 'center' },
  pillTextLeft: { textAlign: 'left' },
  pillTextRight: { textAlign: 'right' },
  recommendMark: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0d9488',
    marginLeft: 2,
  },
  recommendMarkDark: {
    color: '#5eead4',
  },
  rowCenter: {
    justifyContent: 'center',
  },
  rowEnd: {
    justifyContent: 'flex-end',
  },
  rowStart: {
    justifyContent: 'flex-start',
  },
  axisTop: {
    top: -4,
    left: 0,
    right: 0,
    alignSelf: 'center',
    maxWidth: '94%',
  },
  axisRight: {
    right: -6,
    top: '50%',
    marginTop: -20,
    maxWidth: '52%',
  },
  axisBottom: {
    bottom: -4,
    left: 0,
    right: 0,
    alignSelf: 'center',
    maxWidth: '94%',
  },
  axisLeft: {
    left: -6,
    top: '50%',
    marginTop: -20,
    maxWidth: '46%',
  },
});

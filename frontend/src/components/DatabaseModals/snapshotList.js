// Pure helpers for the Load Database dialog: which group a saved snapshot
// belongs to, how to order a group, and a one-line summary of what is in it.
// GET /database/list may or may not send `kind` and `contents` (older
// servers send only `type` and the file name), so every reader falls back.

export const SNAPSHOT_GROUPS = [
  {
    key: 'saves',
    title: 'Your saves',
    help: 'Saved with Save database.',
  },
  {
    key: 'autosaves',
    title: 'Autosaves',
    help: 'Saved automatically, no name needed.',
  },
  {
    key: 'start_clean',
    title: "Safety copies made before 'Start clean'",
    help: 'Your data as it was just before every row was deleted.',
  },
  {
    key: 'before_load',
    title: 'Safety copies made before loading',
    help: 'Your data as it was just before another database was loaded over it.',
  },
  {
    key: 'approvals',
    title: 'Copies made when a scenario was approved',
    help: 'The whole database as it was at the moment of each approval.',
  },
];

// File-name prefixes the server uses for the copies it makes on its own.
const START_CLEAN_PREFIXES = ['start_clean_backup_', 'reset_backup_', 'clear_data_backup_'];
const BEFORE_LOAD_PREFIXES = ['current_backup_', 'pre_revert_backup_', 'force_reload_backup_'];
// The copy taken when a scenario is approved: approved_<id>_<YYYYMMDD_HHMMSS>[_n].db, exactly (as the server
// matches it). A user's own save called 'approved_budget' is a save like any other.
const APPROVAL_SNAPSHOT = /^approved_[a-z0-9_-]+_\d{8}_\d{6}(?:_\d+)?\.db$/;

const lower = (value) => String(value ?? '').toLowerCase();

const fileOf = (item) => lower(item?.filename || item?.name);

/** 'saves' | 'autosaves' | 'start_clean' | 'before_load' | 'approvals' for one /database/list item. */
export const snapshotGroup = (item) => {
  // Whatever the server says about why the copy was made, most specific first.
  const said = [item?.kind, item?.reason, item?.made_before, item?.trigger].map(lower).filter(Boolean).join(' ');
  if (said) {
    if (/approv/.test(said)) return 'approvals';
    if (/start.?clean|reset|clear/.test(said)) return 'start_clean';
    if (/load|revert|reload|restore|switch/.test(said)) return 'before_load';
    if (/auto/.test(said)) return 'autosaves';
    if (/manual|user|named|save/.test(said)) return 'saves';
  }
  const file = fileOf(item);
  const type = lower(item?.type);
  if (APPROVAL_SNAPSHOT.test(file)) return 'approvals';
  if (START_CLEAN_PREFIXES.some((p) => file.startsWith(p))) return 'start_clean';
  if (BEFORE_LOAD_PREFIXES.some((p) => file.startsWith(p))) return 'before_load';
  if (type === 'autosave' || file.startsWith('autosave_')) return 'autosaves';
  if (type === 'system_backup') return 'before_load';
  return 'saves';
};

// 20261012_081715_254 in a file name -> epoch ms (local time), for items without dates.
const timeFromName = (item) => {
  const m = /(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:_(\d{1,3}))?/.exec(fileOf(item));
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), Number(ms || 0)).getTime();
};

/** When the snapshot was saved (epoch ms), or null. */
export const snapshotTime = (item) => {
  for (const key of ['saved_at', 'modified', 'created']) {
    const t = Date.parse(item?.[key]);
    if (Number.isFinite(t)) return t;
  }
  return timeFromName(item);
};

/**
 * Items -> [{key, title, help, items}] in SNAPSHOT_GROUPS order, newest
 * first within a group; empty groups are left out.
 */
export const groupSnapshots = (items) => {
  const buckets = Object.fromEntries(SNAPSHOT_GROUPS.map((g) => [g.key, []]));
  (Array.isArray(items) ? items : []).forEach((item) => {
    if (item && (item.filename || item.name)) buckets[snapshotGroup(item)].push(item);
  });
  return SNAPSHOT_GROUPS
    .map((group) => ({
      ...group,
      items: buckets[group.key].slice().sort((a, b) => {
        const diff = (snapshotTime(b) ?? -Infinity) - (snapshotTime(a) ?? -Infinity);
        if (diff) return diff;
        return String(b.filename || b.name).localeCompare(String(a.filename || a.name));
      }),
    }))
    .filter((group) => group.items.length > 0);
};

const count = (value) => {
  if (Array.isArray(value)) return value.length;
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const firstCount = (...values) => {
  for (const v of values) {
    const n = count(v);
    if (n !== null) return n;
  }
  return null;
};

const plural = (n, one, many) => `${Number(n).toLocaleString('en-US')} ${n === 1 ? one : many}`;

const SCENARIOS_SHOWN = 4;

/** The contents line for one /database/list item (null when the server sent nothing). */
export const describeSnapshot = (item) => {
  if (item?.contents !== undefined && item?.contents !== null) return describeContents(item.contents);
  if (item?.contents_error) return { text: 'Contents could not be read', empty: true };
  return null;
};

/**
 * A snapshot's `contents` -> {text, empty} for one line under its name, or
 * null when the server did not say. Accepts a ready-made string or an object
 * such as {scenarios: ['2027 Budget', ...], customers: 12, sales_rows: 1429}.
 */
export const describeContents = (contents) => {
  if (contents === null || contents === undefined) return null;
  if (typeof contents === 'string') {
    const text = contents.trim();
    if (!text) return null;
    return { text, empty: /^empty\b/i.test(text) };
  }
  if (typeof contents !== 'object') return null;
  if (contents.error && !contents.summary) return { text: 'Contents could not be read', empty: true };

  const counts = contents.counts && typeof contents.counts === 'object' ? contents.counts : {};
  const rawScenarios = contents.scenarios ?? contents.scenario_names ?? counts.scenarios;
  const names = (Array.isArray(rawScenarios) ? rawScenarios : [])
    .map((s) => (typeof s === 'string' ? s : (s?.name || s?.forecast_id || s?.id)))
    .filter(Boolean)
    .map(String);
  const scenarioCount = Math.max(names.length, firstCount(contents.scenario_count, rawScenarios, counts.forecast) || 0);
  const customers = firstCount(contents.customers, contents.customer_count, counts.customers);
  const salesRows = firstCount(contents.sales_rows, contents.sales_row_count, contents.sales, counts.sales);
  const totalRows = firstCount(contents.total_rows, contents.rows);

  // Empty when the server says so, or when every count it sent is zero.
  const numbers = [...Object.values(contents), ...Object.values(counts)]
    .filter((v) => typeof v === 'number' || Array.isArray(v))
    .map(count);
  const explicitlyEmpty = contents.empty === true || contents.is_empty === true || totalRows === 0;
  const nothingCounted = names.length === 0 && numbers.length > 0 && numbers.every((n) => n === 0);
  if (explicitlyEmpty || nothingCounted) return { text: 'Empty database', empty: true };

  const ready = contents.summary || contents.label || contents.text || contents.description;
  if (typeof ready === 'string' && ready.trim()) return { text: ready.trim(), empty: /^empty\b/i.test(ready.trim()) };

  const parts = [];
  if (names.length) {
    const shown = names.slice(0, SCENARIOS_SHOWN);
    const more = Math.max(scenarioCount, names.length) - shown.length;
    parts.push(more > 0 ? `${shown.join(', ')} and ${more} more` : shown.join(', '));
  } else if (scenarioCount) {
    parts.push(plural(scenarioCount, 'scenario', 'scenarios'));
  } else {
    parts.push('No scenarios');
  }
  if (customers !== null) parts.push(plural(customers, 'customer', 'customers'));
  if (salesRows !== null) parts.push(plural(salesRows, 'sales row', 'sales rows'));
  return { text: parts.join(' · '), empty: false };
};

/** The file name a start-clean (or load) response says it saved the previous data as. */
export const backupFilenameFrom = (response) => {
  const data = response?.data ?? response ?? {};
  const backup = data.backup;
  if (backup && typeof backup === 'object' && backup.filename) return backup.filename;
  if (typeof backup === 'string' && backup) return backup;
  if (data.backup_created) return data.backup_created;
  if (data.backup_path) return String(data.backup_path).split(/[\\/]/).pop();
  return null;
};

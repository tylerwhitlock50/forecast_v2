import { backupFilenameFrom, describeContents, describeSnapshot, groupSnapshots, snapshotGroup, snapshotTime } from './snapshotList';

const item = (filename, extra = {}) => ({ filename, name: filename.replace(/\.db$/, ''), ...extra });

describe('snapshotGroup', () => {
  it('uses the kind the server sends', () => {
    expect(snapshotGroup(item('Rehearsal.db', { type: 'manual_save', kind: 'manual_save' }))).toBe('saves');
    expect(snapshotGroup(item('autosave_20261012_081500_001.db', { type: 'autosave', kind: 'autosave' }))).toBe('autosaves');
    expect(snapshotGroup(item('start_clean_backup_20261012_081715_254.db', { type: 'system_backup', kind: 'start_clean_backup' }))).toBe('start_clean');
    expect(snapshotGroup(item('current_backup_20261012_081832_982.db', { type: 'system_backup', kind: 'before_load_backup' }))).toBe('before_load');
    expect(snapshotGroup(item('pre_revert_backup_20261012_090000_000.db', { type: 'system_backup', kind: 'before_revert_backup' }))).toBe('before_load');
    // A generic system backup is placed by its file name.
    expect(snapshotGroup(item('reset_backup_20261012_090000_000.db', { type: 'system_backup', kind: 'system_backup' }))).toBe('start_clean');
    expect(snapshotGroup(item('force_reload_backup_20261012_090000_000.db', { type: 'system_backup', kind: 'system_backup' }))).toBe('before_load');
  });

  it('falls back to the type and file name for older servers', () => {
    expect(snapshotGroup(item('start_clean_backup_20261012_081715_254.db', { type: 'system_backup' }))).toBe('start_clean');
    expect(snapshotGroup(item('current_backup_20261012_081832_982.db', { type: 'system_backup' }))).toBe('before_load');
    expect(snapshotGroup(item('autosave_20261012_081500_001.db', { type: 'autosave' }))).toBe('autosaves');
    expect(snapshotGroup(item('before june cut.db', { type: 'manual_save' }))).toBe('saves');
    expect(snapshotGroup(item('something.db'))).toBe('saves');
  });
});

describe('groupSnapshots', () => {
  it('groups in a fixed order, newest first within a group, and drops empty groups', () => {
    const groups = groupSnapshots([
      item('current_backup_20261012_081815_599.db', { type: 'system_backup', saved_at: '2026-10-12T08:18:15' }),
      item('Old plan.db', { type: 'manual_save', saved_at: '2026-10-01T09:00:00' }),
      item('start_clean_backup_20261012_081715_254.db', { type: 'system_backup', saved_at: '2026-10-12T08:17:15' }),
      item('current_backup_20261012_081832_982.db', { type: 'system_backup', saved_at: '2026-10-12T08:18:32' }),
      item('New plan.db', { type: 'manual_save', saved_at: '2026-10-11T09:00:00' }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['saves', 'start_clean', 'before_load']);
    expect(groups[0].title).toBe('Your saves');
    expect(groups[1].title).toBe("Safety copies made before 'Start clean'");
    expect(groups[2].title).toBe('Safety copies made before loading');
    expect(groups[0].items.map((i) => i.name)).toEqual(['New plan', 'Old plan']);
    expect(groups[2].items.map((i) => i.filename)).toEqual([
      'current_backup_20261012_081832_982.db',
      'current_backup_20261012_081815_599.db',
    ]);
  });

  it('orders by the time in the file name when an item has no dates', () => {
    const a = item('autosave_20261012_081500_001.db', { type: 'autosave' });
    const b = item('autosave_20261013_070000_000.db', { type: 'autosave' });
    expect(snapshotTime(b)).toBeGreaterThan(snapshotTime(a));
    expect(groupSnapshots([a, b])[0].items).toEqual([b, a]);
  });
});

describe('describeContents', () => {
  it('lists scenario names, customers and sales rows', () => {
    expect(describeContents({
      scenarios: ['2027 Budget', '2027 Budget +5%'], scenario_count: 2, customers: 12, products: 8,
      sales_rows: 1429, total_rows: 2300, empty: false,
    })).toEqual({ text: '2027 Budget, 2027 Budget +5% · 12 customers · 1,429 sales rows', empty: false });
  });

  it('says Empty database when the server says so or every count is zero', () => {
    expect(describeContents({ scenarios: [], scenario_count: 0, customers: 0, products: 0, sales_rows: 0, total_rows: 0, empty: true }))
      .toEqual({ text: 'Empty database', empty: true });
    // Scenario names alone (right after Start clean with a scenario name) still count as empty.
    expect(describeContents({ scenarios: ['2027 Budget'], customers: 0, sales_rows: 0, empty: true }).text).toBe('Empty database');
    expect(describeContents({ customers: 0, sales_rows: 0 }).text).toBe('Empty database');
  });

  it('shortens a long scenario list and accepts a ready-made string', () => {
    const many = describeContents({ scenarios: ['A', 'B', 'C', 'D', 'E'], scenario_count: 7, customers: 1, sales_rows: 1, empty: false });
    expect(many.text).toBe('A, B, C, D and 3 more · 1 customer · 1 sales row');
    expect(describeContents('Budget · 3 customers')).toEqual({ text: 'Budget · 3 customers', empty: false });
    expect(describeContents('Empty database')).toEqual({ text: 'Empty database', empty: true });
    expect(describeContents(null)).toBeNull();
  });

  it('says when the contents could not be read', () => {
    expect(describeSnapshot({ contents: null, contents_error: 'file is not a database' }))
      .toEqual({ text: 'Contents could not be read', empty: true });
    expect(describeSnapshot({ filename: 'x.db' })).toBeNull();
  });
});

describe('backupFilenameFrom', () => {
  it('reads the safety copy from a start-clean or load response', () => {
    expect(backupFilenameFrom({ status: 'success', data: { backup: { filename: 'start_clean_backup_1.db' } } })).toBe('start_clean_backup_1.db');
    expect(backupFilenameFrom({ data: { backup_created: 'current_backup_1.db' } })).toBe('current_backup_1.db');
    expect(backupFilenameFrom({ data: { backup: null } })).toBeNull();
  });
});

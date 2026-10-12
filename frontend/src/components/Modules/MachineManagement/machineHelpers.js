// Pure helpers for the Machines screen (tested in machineHelpers.test.js).
//
// Capacity is stored as available_minutes_per_month (the API and the cost
// engine work in minutes) but shown and entered in hours per month, like
// the COGS & labor forecast and the machines import (available_hours_per_month).

const isSet = (value) => value !== null && value !== undefined && String(value).trim() !== '';

/** Stored minutes per month -> hours per month (null when not set). */
export const minutesToHours = (minutes) => {
  if (!isSet(minutes)) return null;
  const n = Number(minutes);
  return Number.isFinite(n) ? n / 60 : null;
};

/** Hours per month typed in the form -> minutes to store (null when blank). */
export const hoursToMinutes = (hours) => {
  if (!isSet(hours)) return null;
  const n = Number(hours);
  return Number.isFinite(n) ? Math.round(n * 60) : null;
};

/** 19200 (minutes) -> '320' ; 100 -> '1.7' ; blank -> null. */
export const formatCapacityHours = (minutes) => {
  const hours = minutesToHours(minutes);
  if (hours === null) return null;
  return hours.toLocaleString('en-US', { maximumFractionDigits: 1 });
};

/** Value for the hours field when editing a machine ('' when not set). */
export const hoursFieldValue = (minutes) => {
  const hours = minutesToHours(minutes);
  if (hours === null) return '';
  return String(Math.round(hours * 100) / 100);
};

/**
 * Checks that affect cost or capacity only: a machine needs an hourly rate
 * (or its machine time costs $0) and a monthly capacity (or the capacity
 * view cannot show how loaded it is). Labor type and description are
 * optional and never reported.
 *
 * Returns {issues: [{machine, issues}], warnings: [{machine, warnings}],
 *          stats: {total, valid, withIssues, withWarnings}}.
 */
export const validateMachines = (machines = []) => {
  const list = Array.isArray(machines) ? machines : [];
  const issues = [];
  const warnings = [];
  const stats = { total: list.length, valid: 0, withIssues: 0, withWarnings: 0 };

  list.forEach((machine, index) => {
    const machineIssues = [];
    const machineWarnings = [];

    if (!isSet(machine.machine_id)) machineIssues.push('Missing machine ID');
    const duplicate = list.find((m, i) => i !== index && isSet(m.machine_id)
      && String(m.machine_id).toLowerCase() === String(machine.machine_id || '').toLowerCase());
    if (duplicate) machineIssues.push('Duplicate machine ID');

    if (!isSet(machine.machine_rate)) {
      machineWarnings.push('No hourly rate: machine time on this machine costs $0');
    } else {
      const rate = Number(machine.machine_rate);
      if (!Number.isFinite(rate) || rate < 0) machineIssues.push('Hourly rate is not a valid positive number');
      else if (rate === 0) machineWarnings.push('Hourly rate is $0: machine time on this machine costs nothing');
    }

    if (!isSet(machine.available_minutes_per_month)) {
      machineWarnings.push('No capacity: set hours per month to see how loaded it is');
    } else {
      const minutes = Number(machine.available_minutes_per_month);
      if (!Number.isFinite(minutes) || minutes < 0) machineIssues.push('Capacity is not a valid positive number');
      else if (minutes === 0) machineWarnings.push('Capacity is 0 hours per month: set hours per month to see how loaded it is');
    }

    if (machineIssues.length > 0) {
      issues.push({ machine, issues: machineIssues });
      stats.withIssues += 1;
    } else if (machineWarnings.length > 0) {
      warnings.push({ machine, warnings: machineWarnings });
      stats.withWarnings += 1;
    } else {
      stats.valid += 1;
    }
  });

  return { issues, warnings, stats };
};

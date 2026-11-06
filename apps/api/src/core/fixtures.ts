import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Synthetic fixture loader.
 *
 * Every fixture in data/ is explicitly marked as synthetic. Nothing here is
 * real organisation data, and no real mail/calendar/task service is ever
 * contacted (AC20).
 */

export interface Site {
  id: string;
  city: string;
  tz: string;
}

export interface Organization {
  org_id: string;
  name: string;
  default_timezone: string;
  sites: Site[];
  workdays: string[];
  work_hours_local: { start: string; end: string };
  date_context: string;
}

export interface User {
  id: string;
  name: string;
  role: string;
  site: string;
  email: string;
  can_approve?: string[];
  can_approve_high_risk?: boolean;
}

export interface People {
  authenticated_actor_id: string;
  users: User[];
}

export interface Policies {
  actions: string[];
  execution_mode: string;
  approval_requirements: {
    exact_preview_fields: string[];
    identity_source: string;
    payload_binding: string;
    reject_if: string[];
    high_risk: string[];
    high_risk_requires: string;
  };
  business_hours_local: Record<string, string>;
  friday_prayer_demo_block_local: { start: string; end: string; notice: string };
  holiday_calendar: {
    status: string;
    organization_days_off: Array<{ date: string; label: string; is_national_holiday: boolean }>;
    national_holidays_for_range: unknown;
    rule: string;
  };
  prompt_injection_rule: string;
  audit_events: string[];
  privacy: string;
}

export interface Meeting {
  id: string;
  title: string;
  date: string;
  timezone: string;
  minutes_status: 'DRAFT_NOT_FINAL' | 'APPROVED';
  document_id: string;
  owner_id: string;
  notes: string[];
}

export interface MeetingContext {
  meetings: Meeting[];
}

export interface Fixtures {
  org: Organization;
  people: People;
  policies: Policies;
  meetings: MeetingContext;
  root: string;
}

let cached: Fixtures | null = null;

export function findWorkspaceRoot(start = process.cwd()): string {
  // On Vercel, the workspace root is set explicitly
  if (process.env.NAVI_WORKSPACE_ROOT) {
    return process.env.NAVI_WORKSPACE_ROOT;
  }
  let dir = resolve(start);
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(resolve(dir, 'data/01_organization.json'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start);
}

export function loadFixtures(root = findWorkspaceRoot()): Fixtures {
  if (cached && cached.root === root) return cached;
  const read = <T>(rel: string): T =>
    JSON.parse(readFileSync(resolve(root, rel), 'utf8')) as T;
  cached = {
    root,
    org: read<Organization>('data/01_organization.json'),
    people: read<People>('data/02_people.json'),
    policies: read<Policies>('data/03_policies.json'),
    meetings: read<MeetingContext>('data/04_meeting_context.json'),
  };
  return cached;
}

export function findUser(fx: Fixtures, userId: string): User | undefined {
  return fx.people.users.find((u) => u.id === userId);
}

export function findUserByName(fx: Fixtures, name: string): User[] {
  const needle = name.trim().toLowerCase();
  return fx.people.users.filter((u) => u.name.toLowerCase() === needle);
}

/** All users who sit at a given site id. */
export function usersAtSite(fx: Fixtures, siteId: string): User[] {
  return fx.people.users.filter((u) => u.site === siteId);
}

export function siteById(fx: Fixtures, siteId: string): Site | undefined {
  return fx.org.sites.find((s) => s.id === siteId);
}

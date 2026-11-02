import type { SubscriptionNotificationType } from "../db/dbimpl";

export interface AlertVariableMap {
  alert_id: number;
  alert_name: string;
  alert_for: string;
  alert_value: string;
  alert_status: string;
  alert_severity: string;
  alert_message: string;
  alert_source: string;
  alert_timestamp: string;
  alert_cta_url: string;
  alert_cta_text: string;
  alert_incident_id?: number;
  alert_incident_url?: string;
  alert_failure_threshold: number;
  alert_success_threshold: number;
  is_resolved: boolean;
  is_triggered: boolean;
}
export interface SiteDataForNotification {
  site_url: string;
  site_name: string;
  site_logo_url: string;
  colors_up: string;
  colors_down: string;
  colors_degraded: string;
  colors_maintenance: string;
}
export interface SubscriptionVariableMap {
  title: string;
  cta_url: string;
  cta_text: string;
  update_text: string;
  update_subject: string;
  update_id: string;
  event_type: SubscriptionNotificationType;
  // Flags for templates that style by what the mail is about. Mustache has no comparisons, so
  // each is a boolean a section can test; only the flags that apply are set.
  update_state?: string;
  is_investigating?: boolean;
  is_identified?: boolean;
  is_monitoring?: boolean;
  is_resolved?: boolean;
  // The worst impact among the incident's monitors: "DOWN", "DEGRADED" or "".
  incident_impact?: string;
  is_down?: boolean;
  is_degraded?: boolean;
  is_maintenance?: boolean;
  // Set on mails about one monitor: its status changed, or it was added to an incident or maintenance.
  monitor_name?: string;
  monitor_tag?: string;
  is_monitor_update?: boolean;
  // A status change: the monitor's status before and after, "UP", "DOWN" or "DEGRADED".
  monitor_status?: string;
  monitor_previous_status?: string;
  is_up?: boolean;
}

export interface EmailCodeVariableMap {
  email_code: string;
  email_subject: string;
  action: string;
}

export interface SMTPConfiguration {
  smtp_host: string;
  smtp_port: number;
  smtp_secure?: boolean;
  smtp_user: string;
  smtp_pass: string;
  smtp_sender: string;
}

export interface ResendAPIConfiguration {
  resend_api_key: string;
  resend_sender_email: string;
}

export type TemplateVariableMap = SubscriptionVariableMap | AlertVariableMap | EmailCodeVariableMap;

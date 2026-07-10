export type UserNotificationType = "threshold_adjusted" | "system_broadcast";

export type UserNotificationPayload = {
  conditionKey?: string;
  nutrients?: string[];
  deepLink?: string;
  [key: string]: unknown;
};

export type CreateUserNotificationInput = {
  userId: number;
  type: UserNotificationType;
  title: string;
  body: string;
  payload?: UserNotificationPayload | null;
};

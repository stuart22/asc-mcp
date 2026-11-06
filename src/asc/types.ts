// Narrow types for the parts of Apple's JSON:API responses we use.
// Field names and enums checked against Apple's App Store Connect OpenAPI spec 4.6
// (developer.apple.com). Everything is optional because Apple omits fields freely.

export type Platform = "IOS" | "MAC_OS" | "TV_OS" | "VISION_OS";
export const PLATFORMS = ["IOS", "MAC_OS", "TV_OS", "VISION_OS"] as const;

export type Linkage = { type: string; id: string };

export type Resource<A = Record<string, unknown>> = {
  type: string;
  id: string;
  attributes?: A;
  relationships?: Record<string, { data?: Linkage | Linkage[] | null }>;
};

export type Doc<A = Record<string, unknown>> = {
  data: Resource<A>[] | Resource<A>;
  included?: Resource<Record<string, unknown>>[];
  links?: { self?: string; next?: string };
  meta?: { paging?: { total?: number; limit?: number } };
};

export type AppAttributes = { name?: string; bundleId?: string; sku?: string; primaryLocale?: string };

export type BuildProcessingState = "PROCESSING" | "FAILED" | "INVALID" | "VALID";
export type BuildAttributes = {
  version?: string;
  uploadedDate?: string;
  expirationDate?: string;
  expired?: boolean;
  minOsVersion?: string;
  processingState?: BuildProcessingState;
  buildAudienceType?: "INTERNAL_ONLY" | "APP_STORE_ELIGIBLE";
};

export type PreReleaseVersionAttributes = { version?: string; platform?: Platform };

export type BetaGroupAttributes = {
  name?: string;
  createdDate?: string;
  isInternalGroup?: boolean;
  publicLinkEnabled?: boolean;
  publicLink?: string;
  publicLinkLimitEnabled?: boolean;
  publicLinkLimit?: number;
  feedbackEnabled?: boolean;
};

export type BetaTesterAttributes = {
  firstName?: string;
  lastName?: string;
  email?: string;
  inviteType?: "EMAIL" | "PUBLIC_LINK";
  state?: "NOT_INVITED" | "INVITED" | "ACCEPTED" | "INSTALLED" | "REVOKED";
};

export type AppStoreVersionAttributes = {
  platform?: Platform;
  versionString?: string;
  /** Preferred over the deprecated appStoreState. */
  appVersionState?: string;
  appStoreState?: string;
  releaseType?: "MANUAL" | "AFTER_APPROVAL" | "SCHEDULED";
  earliestReleaseDate?: string;
  createdDate?: string;
};

export type CustomerReviewAttributes = {
  rating?: number;
  title?: string;
  body?: string;
  reviewerNickname?: string;
  createdDate?: string;
  territory?: string;
};

export type AppStoreVersionLocalizationAttributes = {
  locale?: string;
  description?: string;
  keywords?: string;
  whatsNew?: string;
  promotionalText?: string;
  marketingUrl?: string;
  supportUrl?: string;
};

export type AppInfoAttributes = { state?: string; appStoreState?: string };
export type AppInfoLocalizationAttributes = { locale?: string; name?: string; subtitle?: string };
export type AppScreenshotSetAttributes = { screenshotDisplayType?: string };
export type AppPreviewSetAttributes = { previewType?: string };

export type AppCustomProductPageAttributes = { name?: string; url?: string; visible?: boolean };
export type AppCustomProductPageVersionAttributes = { version?: string; state?: string; deepLink?: string };
export type AppCustomProductPageLocalizationAttributes = { locale?: string; promotionalText?: string };

export const APP_EVENT_STATES = ["DRAFT", "READY_FOR_REVIEW", "WAITING_FOR_REVIEW", "IN_REVIEW", "REJECTED", "ACCEPTED", "APPROVED", "PUBLISHED", "PAST", "ARCHIVED"] as const;
export type AppEventTerritorySchedule = { territories?: string[]; publishStart?: string; eventStart?: string; eventEnd?: string };
export type AppEventAttributes = {
  referenceName?: string;
  badge?: string;
  eventState?: (typeof APP_EVENT_STATES)[number];
  priority?: string;
  purpose?: string;
  territorySchedules?: AppEventTerritorySchedule[];
};
export type AppEventLocalizationAttributes = { locale?: string; name?: string; shortDescription?: string };

/** Shared by screenshot feedback and crash feedback submissions. */
export type BetaFeedbackAttributes = {
  createdDate?: string;
  comment?: string;
  email?: string;
  deviceModel?: string;
  osVersion?: string;
  screenshots?: unknown[];
};

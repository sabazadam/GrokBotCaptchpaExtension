import { z } from "zod";
import { CAPTCHA_TYPE_IDS, type CaptchaTypeId } from "@grokbot/shared";

const captchaTypeEnum = z.enum(CAPTCHA_TYPE_IDS as [CaptchaTypeId, ...CaptchaTypeId[]]);

export const solveRequestSchema = z.object({
  captchaType: captchaTypeEnum,
  websiteURL: z.string().min(1),
  websiteKey: z.string().optional(),
  pageAction: z.string().optional(),
  isInvisible: z.boolean().optional(),
  isEnterprise: z.boolean().optional(),
  enterprisePayload: z.record(z.string(), z.unknown()).optional(),
  turnstileAction: z.string().optional(),
  turnstileCdata: z.string().optional(),
  geetest: z
    .object({
      gt: z.string().optional(),
      challenge: z.string().optional(),
      captchaId: z.string().optional(),
      riskType: z.string().optional(),
      apiServerSubdomain: z.string().optional(),
    })
    .optional(),
  imageBase64: z.string().optional(),
  ocrModule: z.string().optional(),
  proxy: z.string().optional(),
  userAgent: z.string().optional(),
  idempotencyKey: z.string().optional(),
});

export const activateRequestSchema = z.object({
  activationCode: z.string().min(1),
  deviceLabel: z.string().optional(),
});

export const adminActivationCodeSchema = z.object({
  email: z.string().email(),
  deviceLabel: z.string().optional(),
  expiresInMs: z.number().int().positive().optional(),
});

export const adminCreditsSchema = z.object({
  email: z.string().email(),
  credits: z.number().int().positive(),
});

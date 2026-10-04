import type { IdPath } from "../domain/refs";

export const ISSUE_CODES = [
  // schema
  "INVALID_CHANGESET",
  "UNKNOWN_TOOL",
  "NOT_STAGEABLE",
  "INVALID_ARGS",
  // temp IDs
  "DUPLICATE_TEMP_ID",
  "UNKNOWN_TEMP_ID",
  "TEMP_ID_USED_BEFORE_CREATION",
  "TEMP_ID_TYPE_MISMATCH",
  // references
  "UNKNOWN_ID",
  "CROSS_ORG_REFERENCE",
  "WRONG_PARENT",
  // concurrency
  "MISSING_BASE_VERSION",
  "STALE_VERSION",
  "STALE_QUOTE",
  // business rules
  "ILLEGAL_STATUS_TRANSITION",
  "JOB_CLOSED",
  "BUSINESS_RULE",
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

export interface ValidationIssue {
  code: IssueCode;
  message: string;
  /** Index into ChangeSetDraft.operations, or null for ChangeSet-level issues. */
  opIndex: number | null;
  /** Path within the operation's args. */
  path: IdPath;
}

export function issue(code: IssueCode, message: string, opIndex: number | null = null, path: IdPath = []): ValidationIssue {
  return { code, message, opIndex, path };
}

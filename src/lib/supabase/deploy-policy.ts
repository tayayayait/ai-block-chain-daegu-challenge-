export const TARGET_SUPABASE_PROJECT_REF = "zbkuibnalzjwryeckegm" as const;
export const REQUIRED_COMPAT_DEPLOYMENT_CONFIRMATION =
  `${TARGET_SUPABASE_PROJECT_REF}:compat-deployed-and-drained` as const;

interface BuildSupabasePushArgsInput {
  readonly dryRun: boolean;
  readonly linkedProjectRef: string;
  readonly compatibilityConfirmation?: string;
}

export function parseSupabaseDeployCli(args: readonly string[]): { readonly dryRun: boolean } {
  if (args.length === 0) return { dryRun: false };
  if (args.length === 1 && args[0] === "--dry-run") return { dryRun: true };
  throw new Error("UNSUPPORTED_DEPLOY_ARGUMENT");
}

export function buildSupabasePushArgs(input: BuildSupabasePushArgsInput): readonly string[] {
  if (input.linkedProjectRef.trim() !== TARGET_SUPABASE_PROJECT_REF) {
    throw new Error("UNEXPECTED_LINKED_PROJECT");
  }
  if (
    !input.dryRun &&
    input.compatibilityConfirmation !== REQUIRED_COMPAT_DEPLOYMENT_CONFIRMATION
  ) {
    throw new Error("COMPAT_DEPLOYMENT_NOT_CONFIRMED");
  }

  return input.dryRun
    ? (["db", "push", "--linked", "--dry-run"] as const)
    : (["db", "push", "--linked"] as const);
}

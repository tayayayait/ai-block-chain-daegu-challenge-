import {
  createSchemaRegistrationService,
  formatSchemaRegistrationResult,
  parseSchemaRegistrationConfig,
  SchemaRegistrationError,
} from "../src/lib/attestation/schema-registration.server";

async function main(): Promise<void> {
  try {
    const config = parseSchemaRegistrationConfig(process.env);
    const result = await createSchemaRegistrationService({ config }).registerRequiredSchemas();
    process.stdout.write(`${formatSchemaRegistrationResult(result)}\n`);
  } catch (error) {
    const code = error instanceof SchemaRegistrationError ? error.code : "UNEXPECTED_FAILURE";
    process.stderr.write(
      `EAS schema registration failed (${code}). Secret values and provider diagnostics were not printed.\n`,
    );
    process.exitCode = 1;
  }
}

await main();

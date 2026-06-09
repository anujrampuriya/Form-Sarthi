const { SecretManagerServiceClient } = require("@google-cloud/secret-manager");
const dotenv = require("dotenv");

async function loadSecretsFromGCP() {
  // If we are strictly running locally and don't want to use GCP, we can skip
  // to avoid google-gax throwing uncatchable auth errors in the background.
  if (process.env.NODE_ENV === "development" && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log("[Secrets] Local development detected without GCP credentials. Skipping Secret Manager.");
    console.log("[Secrets] Falling back to local .env file or existing environment variables.");
    return;
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT || "your-project-id";
  const secretName = process.env.SECRET_NAME || "FORMSARTHI_SECRETS";
  const secretVersion = "latest";

  const name = `projects/${projectId}/secrets/${secretName}/versions/${secretVersion}`;

  try {
    const client = new SecretManagerServiceClient();
    console.log(`[Secrets] Attempting to load secrets from Google Cloud: ${name}`);
    
    const [version] = await client.accessSecretVersion({ name });
    const payload = version.payload.data.toString("utf8");

    const envConfig = dotenv.parse(payload);
    for (const key in envConfig) {
      if (Object.prototype.hasOwnProperty.call(envConfig, key)) {
        process.env[key] = envConfig[key];
      }
    }
    console.log("[Secrets] Successfully loaded API keys from Google Cloud Secret Manager.");
  } catch (error) {
    console.warn(`[Secrets] Failed to load secrets from GCP: ${error.message}`);
    console.warn("[Secrets] Falling back to local .env file or existing environment variables.");
  }
}

module.exports = { loadSecretsFromGCP };

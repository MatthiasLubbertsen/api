// API name rules, shared by the build (nitro.config.js) and the runtime.
// An API name is the folder name under routes/: lowercase letters and digits only.
// No "_" (it separates the API name from the var name in NITRO_<API>_<VAR>) and no "-".

export const API_NAME_RE = /^[a-z0-9]+$/;

export function isValidApiName(name) {
  return typeof name === "string" && API_NAME_RE.test(name);
}

export function assertValidApiName(name, where = "routes/") {
  if (!isValidApiName(name)) {
    throw new Error(
      `[plof] Invalid API name "${name}" in ${where}. ` +
        `API names must be lowercase letters and digits only (a-z, 0-9), no "_" or "-". ` +
        `Rename the folder, e.g. "${String(name).toLowerCase().replace(/[^a-z0-9]/g, "")}".`,
    );
  }
}

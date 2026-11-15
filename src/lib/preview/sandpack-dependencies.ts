/**
 * Exact versions for packages the Sandpack preview installs from npm at runtime.
 * Never use "latest" here: a new release could change or remove icons and break
 * previews of results users have already generated.
 */
export const SANDPACK_DEPENDENCIES: Record<string, string> = {
  'lucide-react': '1.73.0',
};

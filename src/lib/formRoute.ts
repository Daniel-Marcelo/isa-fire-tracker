const FORM_ROUTES = [
  /^\/holdings\/new$/,
  /^\/holdings\/[^/]+\/edit$/,
  /^\/holdings\/[^/]+\/holdings\/[^/]+$/,
  /^\/fire\/adjust$/,
  /^\/fire\/assumptions$/,
  /^\/allowance$/,
];

export function isFormRoute(pathname: string): boolean {
  return FORM_ROUTES.some(pattern => pattern.test(pathname));
}

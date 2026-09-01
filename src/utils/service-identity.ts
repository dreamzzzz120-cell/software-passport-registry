export function buildServiceIdentity(environment: string, version: string) {
  return {
    service: 'SPR API',
    status: 'operational',
    environment,
    version
  };
}

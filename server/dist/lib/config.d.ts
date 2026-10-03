export interface Config {
    port: number | string;
    host: string;
    dbPath: string | null;
    dashboardOrigins: string[];
    clientDist: string | null;
    proxyRateLimitRpm: number;
    /** JSON body limit (bytes) for the LLM wire surfaces — see
     *  parseRequestBodyLimitBytes. REQUEST_BODY_LIMIT_MB overrides. */
    requestBodyLimitBytes: number;
    nodeEnv: string;
    serveStaticAssets: boolean;
    /**
     * Tri-state override for the CSP `upgrade-insecure-requests` directive (#682).
     * - undefined: auto — emit the directive only when the request arrived over
     *   TLS (or behind an HTTPS reverse proxy that forwarded X-Forwarded-Proto).
     * - true:      always emit (force HTTPS upgrade even on plain HTTP).
     * - false:     never emit (let HTTP LAN installs render the dashboard).
     */
    cspUpgradeInsecureRequests: boolean | undefined;
}
export declare function loadConfig(): Config;
//# sourceMappingURL=config.d.ts.map
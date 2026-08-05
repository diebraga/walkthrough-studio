export function splatUrl(sceneBase: string, splatBaseUrl = ""): string {
    if (!splatBaseUrl) {
        return `${sceneBase}index.ply`;
    }
    const base = splatBaseUrl.endsWith("/") ? splatBaseUrl : `${splatBaseUrl}/`;
    return new URL(`${sceneBase.replace(/^\/+/, "")}index.ply`, base).href;
}

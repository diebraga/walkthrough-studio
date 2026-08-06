export function splatFileTypeUrl(url: string): string {
    return url.split(/[?#]/, 1)[0] ?? url;
}

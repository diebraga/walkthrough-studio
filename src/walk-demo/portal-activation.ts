export interface PortalActivationObservation {
    activate: boolean;
    armed: boolean;
}

/** Allows one activation per portal entry and waits for an exit after arrival. */
export class PortalActivationGate {
    private armed = true;
    private observedPortalKey: string | null = null;

    disarmForArrival(): void {
        this.armed = false;
    }

    observe(portalKey: string | null): PortalActivationObservation {
        if (portalKey === null) {
            this.observedPortalKey = null;
            this.armed = true;
            return { activate: false, armed: this.armed };
        }

        const activate = this.armed && portalKey !== this.observedPortalKey;
        this.observedPortalKey = portalKey;
        return { activate, armed: this.armed };
    }

    reset(): void {
        this.armed = true;
        this.observedPortalKey = null;
    }
}

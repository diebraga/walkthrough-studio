import {
    Blending,
    BufferAttribute,
    BufferGeometry,
    DrawableRenderMode,
    Mesh,
    MeshBasicMaterial,
    Side,
    Vector3,
    type Scene3D,
} from '@manycore/aholo-viewer';
import type { Portal } from './portals';

const PORTAL = 0x33bbff;

export const PORTAL_VISUAL = {
    glowRadius: 1.7,
    floorOffset: 1.2,
    renderOrder: 10_000,
    jetRadius: 0.15,
    jetHeight: 1.6,
} as const;

export const PORTAL_MATERIAL_OPTIONS = {
    enableVertexColor: true,
    transparent: true,
    blending: Blending.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    side: Side.DoubleSide,
} as const;

export interface PortalMarkerGeometry {
    positions: number[];
    colors: number[];
}

function hexToRgb(hex: number): [number, number, number] {
    return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

/**
 * Build one portal's marker in local space as a planar radial glow. The black
 * edge vertices become invisible under additive blending.
 */
export function buildPortalMarker(radius: number, colorHex: number): PortalMarkerGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const [r, g, b] = hexToRgb(colorHex);
    const segments = 24;
    for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        positions.push(0, 0, 0);
        colors.push(r, g, b);
        positions.push(Math.cos(a0) * radius, 0, Math.sin(a0) * radius);
        colors.push(0, 0, 0);
        positions.push(Math.cos(a1) * radius, 0, Math.sin(a1) * radius);
        colors.push(0, 0, 0);
    }

    return { positions, colors };
}

/**
 * Build a thin bipolar jet: two opposing cones sharing an apex at the disk's
 * center, tapering outward along +y and -y (the disk's normal). Same
 * colored-apex/black-rim trick as the disk, so each cone fades toward its
 * tip instead of a hard cutoff.
 */
export function buildPortalJet(baseRadius: number, height: number, colorHex: number): PortalMarkerGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    const [r, g, b] = hexToRgb(colorHex);
    const segments = 24;
    for (const direction of [1, -1]) {
        for (let i = 0; i < segments; i++) {
            const a0 = (i / segments) * Math.PI * 2;
            const a1 = ((i + 1) / segments) * Math.PI * 2;
            positions.push(0, 0, 0);
            colors.push(r, g, b);
            positions.push(Math.cos(a0) * baseRadius, height * direction, Math.sin(a0) * baseRadius);
            colors.push(0, 0, 0);
            positions.push(Math.cos(a1) * baseRadius, height * direction, Math.sin(a1) * baseRadius);
            colors.push(0, 0, 0);
        }
    }

    return { positions, colors };
}

export class PortalRenderer {
    private readonly scene: Scene3D;
    private meshes: InstanceType<typeof Mesh>[] = [];
    private key = '';
    private visible = true;

    constructor(scene: Scene3D) {
        this.scene = scene;
    }

    update(portals: readonly Portal[], floorY: number): void {
        const key = `${floorY.toFixed(2)}|${portals.map((portal) => `${portal.name}:${portal.position.x.toFixed(2)}:${portal.position.z.toFixed(2)}`).join('|')}`;
        if (key === this.key) {
            return;
        }
        this.key = key;
        this.disposeMeshes();

        for (const portal of portals) {
            const disk = buildPortalMarker(PORTAL_VISUAL.glowRadius, PORTAL);
            const jet = buildPortalJet(PORTAL_VISUAL.jetRadius, PORTAL_VISUAL.jetHeight, PORTAL);
            const marker: PortalMarkerGeometry = {
                positions: [...disk.positions, ...jet.positions],
                colors: [...disk.colors, ...jet.colors],
            };
            const geometry = new BufferGeometry();
            geometry.setAttribute('position', new BufferAttribute(new Float32Array(marker.positions), 3));
            geometry.setAttribute('color', new BufferAttribute(new Float32Array(marker.colors), 3));
            const material = new MeshBasicMaterial(PORTAL_MATERIAL_OPTIONS);
            const mesh = new Mesh(geometry as never, material as never);
            mesh.position = new Vector3(portal.position.x, floorY + PORTAL_VISUAL.floorOffset, portal.position.z);
            mesh.renderOrder = PORTAL_VISUAL.renderOrder;
            // Gaussian splats render in their own OIT pass, after ordinary
            // transparent meshes, and paint over whatever's already in the
            // framebuffer wherever splat density exists — so a normal
            // transparent mesh only shows through where there's no splat to
            // cover it. Overlay mode draws after that pass instead.
            mesh.renderMode = DrawableRenderMode.Overlay;
            mesh.visible = this.visible;
            this.scene.add(mesh as never);
            this.meshes.push(mesh);
        }
    }

    setVisible(visible: boolean): void {
        this.visible = visible;
        for (const mesh of this.meshes) {
            mesh.visible = visible;
        }
    }

    dispose(): void {
        this.disposeMeshes();
        this.key = '';
    }

    private disposeMeshes(): void {
        for (const mesh of this.meshes) {
            mesh.removeFromParent?.();
            mesh.freeAllGpuResourceOwned?.();
        }
        this.meshes = [];
    }
}

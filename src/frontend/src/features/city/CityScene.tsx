import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import type { PreviewTile, TileKind } from "./map";
import { previewTiles, toWorld } from "./map";
import { useTranslation } from "react-i18next";

const tileColors: Record<TileKind, string> = {
  civic: "#ebae70",
  commerce: "#69bea7",
  park: "#9ec785",
  residential: "#7697b6",
};
const figurines: ReadonlyArray<{ tile: string; color: string; cap: string }> = [
  { tile: "0:0", color: "#eea477", cap: "#a95c5b" },
  { tile: "1:-1", color: "#8bd0c2", cap: "#467c87" },
  { tile: "-2:1", color: "#c5a9ed", cap: "#705eab" },
  { tile: "1:1", color: "#e2c782", cap: "#9d7b51" },
];

function CityBlock({ kind }: { kind: TileKind }) {
  if (kind === "park") {
    return (
      <group>
        <mesh castShadow position={[-0.24, 0.23, -0.08]}>
          <cylinderGeometry args={[0.07, 0.1, 0.32, 6]} />
          <meshStandardMaterial color="#876c51" />
        </mesh>
        <mesh castShadow position={[-0.24, 0.5, -0.08]}>
          <dodecahedronGeometry args={[0.29, 0]} />
          <meshStandardMaterial color="#4e956f" roughness={0.88} />
        </mesh>
        <mesh castShadow position={[0.3, 0.29, 0.08]}>
          <dodecahedronGeometry args={[0.24, 0]} />
          <meshStandardMaterial color="#75b77b" roughness={0.9} />
        </mesh>
      </group>
    );
  }

  const height = kind === "civic" ? 0.8 : kind === "commerce" ? 0.56 : 0.4;
  const facade = kind === "civic" ? "#f4dab1" : kind === "commerce" ? "#e5f4e7" : "#dde9f1";
  const roof = kind === "civic" ? "#c88057" : kind === "commerce" ? "#4d8d84" : "#577695";

  return (
    <group position={[0, 0.18, 0]}>
      <mesh castShadow receiveShadow position={[0, height / 2, 0]}>
        <boxGeometry args={[kind === "civic" ? 0.72 : 0.66, height, 0.58]} />
        <meshStandardMaterial color={facade} roughness={0.82} />
      </mesh>
      <mesh castShadow position={[0, height + 0.08, 0]}>
        <boxGeometry args={[0.83, 0.15, 0.69]} />
        <meshStandardMaterial color={roof} roughness={0.68} />
      </mesh>
      <mesh position={[0, height * 0.5, 0.301]}>
        <boxGeometry args={[0.19, 0.24, 0.012]} />
        <meshStandardMaterial color="#416377" metalness={0.15} />
      </mesh>
    </group>
  );
}

function Hex({ tile, selected, onSelect }: { tile: PreviewTile; selected: boolean; onSelect: (id: string) => void }) {
  const [x, z] = toWorld(tile.q, tile.r);
  return (
    <group position={[x, 0, z]}>
      {selected && (
        <mesh position={[0, -0.035, 0]} rotation={[0, Math.PI / 6, 0]}>
          <cylinderGeometry args={[1.055, 1.055, 0.3, 6]} />
          <meshStandardMaterial color="#f7d18b" emissive="#b87b2b" emissiveIntensity={0.5} />
        </mesh>
      )}
      <mesh
        castShadow
        receiveShadow
        onClick={(event) => { event.stopPropagation(); onSelect(tile.id); }}
        rotation={[0, Math.PI / 6, 0]}
        position={[0, 0.07, 0]}
      >
        <cylinderGeometry args={[1, 1, 0.32, 6]} />
        <meshStandardMaterial color={tileColors[tile.kind]} roughness={0.92} />
      </mesh>
      <CityBlock kind={tile.kind} />
    </group>
  );
}

function Pucciottino({ tileId, color, cap }: { tileId: string; color: string; cap: string }) {
  const tile = previewTiles.find((item) => item.id === tileId);
  const [x, z] = tile ? toWorld(tile.q, tile.r) : [0, 0];
  return (
    <group position={[x + 0.33, 0.66, z + 0.34]} scale={0.72}>
      <mesh castShadow position={[0, 0.04, 0]}>
        <sphereGeometry args={[0.37, 18, 14]} />
        <meshStandardMaterial color={color} roughness={0.66} />
      </mesh>
      <mesh castShadow position={[0, 0.48, 0]}>
        <sphereGeometry args={[0.32, 18, 14]} />
        <meshStandardMaterial color={color} roughness={0.66} />
      </mesh>
      <mesh castShadow position={[0, 0.77, 0]}>
        <sphereGeometry args={[0.29, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={cap} roughness={0.87} />
      </mesh>
      {[-0.13, 0.13].map((eye) => (
        <mesh key={eye} position={[eye, 0.52, 0.281]}>
          <sphereGeometry args={[0.045, 10, 10]} />
          <meshStandardMaterial color="#243746" />
        </mesh>
      ))}
      <mesh position={[0, 0.39, 0.296]}>
        <sphereGeometry args={[0.035, 10, 10]} />
        <meshStandardMaterial color="#b66061" />
      </mesh>
    </group>
  );
}

function WebGLCity({ selectedId, onSelect }: { selectedId: string; onSelect: (id: string) => void }) {
  const tiles = useMemo(() => previewTiles, []);
  return (
    <Canvas
      shadows
      dpr={[1, 1.7]}
      camera={{ position: [10, 12, 13], fov: 43, near: 0.1, far: 90 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ width: "100%", height: "100%" }}
    >
      <color attach="background" args={["#10212b"]} />
      <fog attach="fog" args={["#10212b", 18, 38]} />
      <ambientLight intensity={1.6} />
      <directionalLight
        castShadow
        position={[6, 12, 7]}
        intensity={2.4}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.31, 0]} receiveShadow>
        <planeGeometry args={[120, 120]} />
        <meshStandardMaterial color="#102a30" roughness={1} />
      </mesh>
      <group>
        {tiles.map((tile) => <Hex key={tile.id} tile={tile} selected={tile.id === selectedId} onSelect={onSelect} />)}
        {figurines.map((figure) => <Pucciottino key={figure.tile} tileId={figure.tile} color={figure.color} cap={figure.cap} />)}
      </group>
      <ContactShadows position={[0, -0.18, 0]} opacity={0.25} scale={20} blur={2.2} far={7} />
      <OrbitControls enablePan={false} minDistance={8} maxDistance={25} maxPolarAngle={Math.PI / 2.15} minPolarAngle={0.35} target={[0, 0, 0]} />
    </Canvas>
  );
}

function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function CityScene({ selectedId, onSelect }: { selectedId: string; onSelect: (id: string) => void }) {
  const supported = useMemo(webglAvailable, []);
  const { t } = useTranslation();
  return supported
    ? <WebGLCity selectedId={selectedId} onSelect={onSelect} />
    : <div role="status" className="flex h-full items-center justify-center p-10 text-center text-sm text-slate-200">{t("city.fallback")}</div>;
}

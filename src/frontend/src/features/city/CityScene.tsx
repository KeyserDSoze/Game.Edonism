import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { useTranslation } from "react-i18next";
import { cityBoard, toScene, type ActivitySlot, type RoadArea, type Street } from "./board";

type SceneProps = {
  selectedStreetId: string;
  selectedSlotId: string | null;
  onStreetSelect: (streetId: string) => void;
  onSlotSelect: (slotId: string) => void;
};

const blockColors = ["#e9cbb3", "#dce6da", "#c8dce5", "#f0dfbd", "#d5c9da", "#e4dacb"];
const roofColors = ["#9b6a58", "#587a75", "#56778e", "#aa8665", "#877493", "#8c806e"];

function footprintId(id: string): number {
  return Array.from(id).reduce((sum, letter) => sum * 31 + letter.charCodeAt(0), 7) >>> 0;
}

function Road({ road, selected, onSelect }: { road: RoadArea; selected: boolean; onSelect: (id: string) => void }) {
  const [x, z] = toScene(road.center);
  const sizeX = road.width / 95;
  const sizeZ = road.height / 95;
  return (
    <mesh
      position={[x, selected ? 0.075 : 0.052, z]}
      receiveShadow
      onClick={(event) => { event.stopPropagation(); onSelect(road.streetId); }}
    >
      <boxGeometry args={[sizeX, 0.06, sizeZ]} />
      <meshStandardMaterial color={selected ? "#496f77" : road.streetId === "main-square" ? "#65747a" : "#495661"} roughness={1} />
    </mesh>
  );
}

function Building({ slot, selected, onSelect }: { slot: ActivitySlot; selected: boolean; onSelect: (id: string) => void }) {
  const [x, z] = toScene(slot.center);
  const index = footprintId(slot.id) % blockColors.length;
  const height = 0.42 + (footprintId(slot.id + "height") % 5) * 0.125;
  const width = 1.03;
  return (
    <group position={[x, 0, z]}>
      <mesh
        castShadow
        receiveShadow
        onClick={(event) => { event.stopPropagation(); onSelect(slot.id); }}
        position={[0, 0.115, 0]}
      >
        <boxGeometry args={[1.4, 0.19, 1.39]} />
        <meshStandardMaterial color={selected ? "#f1ca7e" : "#769b78"} roughness={0.9} />
      </mesh>
      {selected && (
        <mesh position={[0, 0.23, 0]}>
          <boxGeometry args={[1.29, 0.035, 1.28]} />
          <meshStandardMaterial color="#f4cf80" emissive="#dfac5b" emissiveIntensity={0.3} />
        </mesh>
      )}
      <mesh
        castShadow
        receiveShadow
        onClick={(event) => { event.stopPropagation(); onSelect(slot.id); }}
        position={[0, 0.21 + height / 2, 0]}
      >
        <boxGeometry args={[width, height, 0.94]} />
        <meshStandardMaterial color={blockColors[index]} roughness={0.88} />
      </mesh>
      <mesh
        castShadow
        onClick={(event) => { event.stopPropagation(); onSelect(slot.id); }}
        position={[0, 0.22 + height + 0.07, 0]}
      >
        <boxGeometry args={[1.16, 0.13, 1.08]} />
        <meshStandardMaterial color={roofColors[index]} roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.32 + height * 0.35, 0.476]}>
        <boxGeometry args={[0.3, 0.2, 0.015]} />
        <meshStandardMaterial color="#47677a" metalness={0.15} />
      </mesh>
    </group>
  );
}

function CityHall() {
  const [x, z] = toScene(cityBoard.cityHall);
  return (
    <group position={[x, 0, z]}>
      <mesh castShadow receiveShadow position={[0, 0.22, 0]}>
        <boxGeometry args={[1.85, 0.32, 1.55]} />
        <meshStandardMaterial color="#c1c9c3" />
      </mesh>
      <mesh castShadow position={[0, 0.72, 0]}>
        <boxGeometry args={[1.52, 0.73, 1.24]} />
        <meshStandardMaterial color="#f1e6d5" />
      </mesh>
      <mesh castShadow position={[0, 1.17, 0]}>
        <boxGeometry args={[1.85, 0.19, 1.51]} />
        <meshStandardMaterial color="#b47769" />
      </mesh>
      <mesh castShadow position={[0, 1.52, 0]}>
        <cylinderGeometry args={[0.19, 0.27, 0.56, 8]} />
        <meshStandardMaterial color="#d6b978" metalness={0.28} />
      </mesh>
    </group>
  );
}

// Decorative, not a player position or an actual turn state.
function Pucciottino({ x, z, color }: { x: number; z: number; color: string }) {
  return (
    <group position={[x, 0.21, z]} scale={0.66}>
      <mesh castShadow position={[0, 0.25, 0]}>
        <sphereGeometry args={[0.26, 14, 12]} />
        <meshStandardMaterial color={color} roughness={0.72} />
      </mesh>
      <mesh castShadow position={[0, 0.65, 0]}>
        <sphereGeometry args={[0.33, 18, 14]} />
        <meshStandardMaterial color={color} roughness={0.65} />
      </mesh>
      {[-0.13, 0.13].map((eye) => (
        <mesh key={eye} position={[eye, 0.69, 0.296]}>
          <sphereGeometry args={[0.045, 10, 10]} />
          <meshStandardMaterial color="#29323b" />
        </mesh>
      ))}
    </group>
  );
}

function RoadLabel({ street }: { street: Street }) {
  const [x, z] = toScene(street.label);
  return (
    <Html
      center
      position={[x, 0.28, z]}
      distanceFactor={14}
      style={{ pointerEvents: "none", whiteSpace: "nowrap" }}
    >
      <span className="rounded-md border border-white/25 bg-slate-900/80 px-2 py-1 text-[10px] font-semibold text-white shadow-lg">
        {street.name}
      </span>
    </Html>
  );
}

function World({ selectedStreetId, selectedSlotId, onStreetSelect, onSlotSelect }: SceneProps) {
  const roads = useMemo(() => cityBoard.roads, []);
  const slots = useMemo(() => cityBoard.slots, []);
  const [pucciX1, pucciZ1] = toScene({ x: 130, y: 225 });
  const [pucciX2, pucciZ2] = toScene({ x: 1150, y: 785 });
  const [pucciX3, pucciZ3] = toScene({ x: 740, y: 705 });

  return (
    <Canvas
      shadows
      dpr={[1, 1.6]}
      camera={{ position: [12, 16, 17], fov: 46, near: 0.1, far: 90 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ width: "100%", height: "100%" }}
    >
      <color attach="background" args={["#13242b"]} />
      <ambientLight intensity={1.8} />
      <directionalLight castShadow position={[7, 14, 8]} intensity={2.3} shadow-mapSize={[1024, 1024]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={-12} shadow-camera-bottom={12} />
      <mesh receiveShadow position={[0, -0.09, 0]}>
        <boxGeometry args={[cityBoard.width / 95 + 0.22, 0.2, cityBoard.height / 95 + 0.22]} />
        <meshStandardMaterial color="#476a51" roughness={1} />
      </mesh>
      {roads.map((road, index) => (
        <Road key={index} road={road} selected={road.streetId === selectedStreetId} onSelect={onStreetSelect} />
      ))}
      {slots.map((slot) => (
        <Building key={slot.id} slot={slot} selected={slot.id === selectedSlotId} onSelect={onSlotSelect} />
      ))}
      <CityHall />
      <Pucciottino x={pucciX1} z={pucciZ1} color="#f2ad86" />
      <Pucciottino x={pucciX2} z={pucciZ2} color="#a7cdd2" />
      <Pucciottino x={pucciX3} z={pucciZ3} color="#d7b8e5" />
      {cityBoard.streets.map((street) => <RoadLabel key={street.id} street={street} />)}
      <OrbitControls enablePan={false} minDistance={13} maxDistance={32} minPolarAngle={0.33} maxPolarAngle={Math.PI / 2.15} target={[0, 0.18, 0]} />
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

export function CityScene(props: SceneProps) {
  const supported = useMemo(webglAvailable, []);
  const { t } = useTranslation();
  return supported
    ? <World {...props} />
    : <div role="status" className="flex h-full items-center justify-center p-10 text-center text-sm text-slate-200">{t("city.fallback")}</div>;
}

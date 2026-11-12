import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { useTranslation } from "react-i18next";
import { cityBoard, toScene, type ActivitySlot, type RoadArea, type Street } from "./board";
import type { PlayerMarkerPlacement } from "./playerMarkers";
import type { ControlledLotMarker } from "./activityMarkers";
import type { TacticalFocus } from "./tacticalFocus";
import type { HistoricalStreetFocus } from "./historicalStreetFocus";

type SceneProps = {
  selectedStreetId: string;
  selectedSlotId: string | null;
  tacticalFocus: TacticalFocus | null;
  historicalFocus: HistoricalStreetFocus | null;
  onStreetSelect: (streetId: string) => void;
  onSlotSelect: (slotId: string) => void;
  /** Server-originated public match positions; never client-selected coordinates. */
  playerMarkers: readonly PlayerMarkerPlacement[];
  controlMarkers: readonly ControlledLotMarker[];
  hasActiveMatch: boolean;
};

const blockColors = ["#e9cbb3", "#dce6da", "#c8dce5", "#f0dfbd", "#d5c9da", "#e4dacb"];
const roofColors = ["#9b6a58", "#587a75", "#56778e", "#aa8665", "#877493", "#8c806e"];

function footprintId(id: string): number {
  return Array.from(id).reduce((sum, letter) => sum * 31 + letter.charCodeAt(0), 7) >>> 0;
}

function Road({ road, selected, highlighted, historical, onSelect }: {
  road: RoadArea; selected: boolean; highlighted: boolean; historical: boolean;
  onSelect: (id: string) => void;
}) {
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
      <meshStandardMaterial
        color={historical ? "#f0b55b" : highlighted ? "#31b7aa" : selected ? "#496f77" : road.streetId === "main-square" ? "#65747a" : "#495661"}
        emissive={historical ? "#ad6b18" : highlighted ? "#127b73" : "#000000"}
        emissiveIntensity={historical || highlighted ? 0.35 : 0}
        roughness={1} />
    </mesh>
  );
}

function Building({ slot, selected, focused, onSelect, control }: {
  slot: ActivitySlot;
  selected: boolean;
  focused: boolean;
  onSelect: (id: string) => void;
  control?: ControlledLotMarker;
}) {
  const [x, z] = toScene(slot.center);
  const index = footprintId(slot.id) % blockColors.length;
  const height = 0.42 + (footprintId(slot.id + "height") % 5) * 0.125;
  const width = 1.03;
  return (
    <group position={[x, 0, z]}>
      {focused && (
        <mesh position={[0, 0.065, 0]}>
          <boxGeometry args={[1.65, 0.05, 1.65]} />
          <meshStandardMaterial color="#32ccc1" emissive="#15978a" emissiveIntensity={0.5} />
        </mesh>
      )}
      <mesh
        castShadow
        receiveShadow
        onClick={(event) => { event.stopPropagation(); onSelect(slot.id); }}
        position={[0, 0.115, 0]}
      >
        <boxGeometry args={[1.4, 0.19, 1.39]} />
        <meshStandardMaterial color={selected ? "#f1ca7e" : control?.color ?? "#769b78"} roughness={0.9} />
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
      {control && <ControlledHenchman control={control} />}
    </group>
  );
}

/**
 * One publicly controlled slot = one deployed henchman (#14).
 * Standing is upright; Fallen is horizontal. This is a READ-ONLY mesh:
 * no interaction changes posture, ownership or game economy.
 */
function ControlledHenchman({ control }: { control: ControlledLotMarker }) {
  const fallen = control.posture === "fallen";
  return (
    <group position={[0.62, 0.28, 0.62]}>
      <mesh receiveShadow position={[0, -0.07, 0]}>
        <cylinderGeometry args={[0.20, 0.20, 0.08, 16]} />
        <meshStandardMaterial color={control.color} metalness={0.1} roughness={0.85} />
      </mesh>
      <group position={[0, fallen ? 0.05 : 0.17, 0]} rotation={[0, 0, fallen ? Math.PI / 2 : 0]}>
        <mesh castShadow>
          <cylinderGeometry args={[0.09, 0.12, 0.30, 12]} />
          <meshStandardMaterial color={control.color} roughness={0.65} />
        </mesh>
        <mesh castShadow position={[0, 0.20, 0]}>
          <sphereGeometry args={[0.12, 12, 12]} />
          <meshStandardMaterial color={control.color} roughness={0.65} />
        </mesh>
      </group>
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

/** A Pucciottino now represents a PUBLIC server player street, not an action. */
function PlayerPucciottino({ marker, focused }: {
  marker: PlayerMarkerPlacement; focused: boolean;
}) {
  return (
    <group position={[marker.x, 0, marker.z]}>
      {focused && (
        <mesh position={[0, 0.10, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.49, 0.075, 8, 32]} />
          <meshStandardMaterial color="#5ce0d4" emissive="#17a79a" emissiveIntensity={0.7} />
        </mesh>
      )}
      {marker.isActive && (
        <mesh position={[0, 0.13, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.37, 0.05, 8, 24]} />
          <meshStandardMaterial color="#fce29d" emissive="#e8b85d" emissiveIntensity={0.7} />
        </mesh>
      )}
      <Pucciottino x={0} z={0} color={marker.color} />
      <Html
        center
        position={[0, 1.05, 0]}
        distanceFactor={12}
        style={{ pointerEvents: "none", whiteSpace: "nowrap" }}
      >
        <span className={marker.isActive
          ? "rounded-md border border-yellow-300 bg-slate-950/95 px-1.5 py-0.5 text-[11px] font-bold text-white shadow"
          : "rounded-md border border-white/30 bg-slate-900/90 px-1.5 py-0.5 text-[11px] font-medium text-white shadow"}>
          {marker.playerId}
        </span>
      </Html>
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

function World({ selectedStreetId, selectedSlotId, tacticalFocus, historicalFocus,
  onStreetSelect, onSlotSelect, playerMarkers, controlMarkers, hasActiveMatch }: SceneProps) {
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
        <Road key={index} road={road} selected={road.streetId === selectedStreetId}
          highlighted={tacticalFocus?.streetPath.includes(road.streetId) ?? false}
          historical={historicalFocus?.streetId === road.streetId}
          onSelect={onStreetSelect} />
      ))}
      {slots.map((slot) => (
        <Building key={slot.id} slot={slot} selected={slot.id === selectedSlotId}
          focused={(tacticalFocus?.kind === "activity" || tacticalFocus?.kind === "opponent-lot") && tacticalFocus.targetId === slot.id}
          onSelect={onSlotSelect} control={controlMarkers.find((marker) => marker.slotId === slot.id)} />
      ))}
      <CityHall />
      {hasActiveMatch
        ? playerMarkers.map((marker) => <PlayerPucciottino key={marker.playerId}
            marker={marker}
            focused={tacticalFocus?.kind === "player" && tacticalFocus.targetId === marker.playerId} />)
        : (
          <>
            <Pucciottino x={pucciX1} z={pucciZ1} color="#f2ad86" />
            <Pucciottino x={pucciX2} z={pucciZ2} color="#a7cdd2" />
            <Pucciottino x={pucciX3} z={pucciZ3} color="#d7b8e5" />
          </>
        )}
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

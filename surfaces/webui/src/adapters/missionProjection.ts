import type {
  MissionControlProjection,
  MissionMaterializedSnapshot,
  MissionProjectionDelta,
} from '../types';

export function applyMissionProjectionDelta(
  current: MissionMaterializedSnapshot | null,
  delta: MissionProjectionDelta,
): MissionMaterializedSnapshot | null {
  if (
    !current
    || delta.needs_resync
    || delta.from_cursor !== current.cursor
    || delta.from_revision !== current.revision
  ) return null;

  const projection = { ...current.projection } as MissionControlProjection;
  for (const [key, value] of Object.entries(delta.patch || {})) {
    if (Object.hasOwn(projection, key)) {
      (projection as Record<string, unknown>)[key] = value;
    }
  }
  return {
    ...current,
    cursor: delta.to_cursor,
    revision: delta.revision,
    needs_resync: false,
    projection,
  };
}

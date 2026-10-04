import type { EntityKey, EntitySnapshot, ValidationRepository } from "../validation/repository";

/** A ValidationRepository backed by an array, for tests and local tooling. */
export class InMemoryRepository implements ValidationRepository {
  private readonly byKey = new Map<string, EntitySnapshot>();

  constructor(snapshots: EntitySnapshot[] = []) {
    for (const s of snapshots) this.put(s);
  }

  put(snapshot: EntitySnapshot): void {
    this.byKey.set(`${snapshot.entity}:${snapshot.id}`, snapshot);
  }

  async getEntities(keys: readonly EntityKey[]): Promise<EntitySnapshot[]> {
    return keys.flatMap((k) => this.byKey.get(`${k.entity}:${k.id}`) ?? []);
  }
}

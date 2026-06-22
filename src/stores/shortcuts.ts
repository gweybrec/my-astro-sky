import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  type Bindings,
  type ShortcutActionId,
  assignKey,
  findConflicts,
  importBindings,
  loadBindings,
  resetBinding,
  reverseMap,
  saveBindings,
  defaultBindings,
} from '../keyboard-shortcuts';

export const useShortcutsStore = defineStore('shortcuts', () => {
  const bindings = ref<Bindings>(loadBindings());

  /** key string → action ids (used by the dispatcher; first id wins on conflict). */
  const keyToAction = computed(() => reverseMap(bindings.value));

  /** Action ids whose key collides with another action. */
  const conflicts = computed(() => findConflicts(bindings.value));

  function persist() {
    saveBindings(bindings.value);
  }

  function setBinding(id: ShortcutActionId, key: string) {
    bindings.value = assignKey(bindings.value, id, key);
    persist();
  }

  function resetOne(id: ShortcutActionId) {
    bindings.value = resetBinding(bindings.value, id);
    persist();
  }

  function resetAll() {
    bindings.value = defaultBindings();
    persist();
  }

  function importJSON(data: unknown) {
    bindings.value = importBindings(data);
    persist();
  }

  return {
    bindings,
    keyToAction,
    conflicts,
    setBinding,
    resetOne,
    resetAll,
    importJSON,
  };
});

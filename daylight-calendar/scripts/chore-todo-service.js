'use strict';

const DEFAULT_CHORE_ENTITY = 'todo.daylight_chores';

function createChoreTodoService({ callHaApi, getEntityId }) {
  return {
    async getItems() {
      const entityId = getEntityId() || DEFAULT_CHORE_ENTITY;
      if (!/^todo\.[a-z0-9_]+$/.test(entityId)) {
        throw new Error('Configure todo_entity_id with a valid Home Assistant to-do entity ID');
      }
      const states = await callHaApi('/states');
      const entity = states.find(state => state.entity_id === entityId);
      if (!entity) {
        throw new Error(`Chore list ${entityId} was not found. Create a local to-do list named Daylight Chores in Home Assistant, or set the add-on's todo_entity_id option to your chore list.`);
      }
      if (['unavailable', 'unknown'].includes(entity.state)) {
        throw new Error(`Chore list ${entityId} is unavailable`);
      }
      const response = await callHaApi('/services/todo/get_items?return_response', {
        method: 'POST',
        body: JSON.stringify({ entity_id: entityId })
      });
      const data = response?.service_response || response;
      if (!Array.isArray(data?.[entityId]?.items)) {
        throw new Error(`Home Assistant did not return items for ${entityId}`);
      }
      return { entityId, items: data[entityId].items };
    }
  };
}

module.exports = { createChoreTodoService };

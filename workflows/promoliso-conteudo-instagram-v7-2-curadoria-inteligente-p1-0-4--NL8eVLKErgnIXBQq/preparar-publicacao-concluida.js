const prepared =
  $('Preparar registro pendente').item.json || {};
const container =
  $('Create a carousel post').item.json || {};
const published =
  $('Publish a post').item.json || {};
const story = $json || {};

return [{
  json: {
    ...prepared,
    operational_status: 'PUBLISHED',
    carousel_container_id: String(
      container.id || container.container_id || '',
    ),
    instagram_post_id: String(
      published.id || published.post_id || published.media_id || '',
    ),
    instagram_story_id: String(
      story.id || story.story_id || story.media_id || '',
    ),
    execution_id: String($execution.id || ''),
    published_at: new Date().toISOString(),
    error_message: '',
  },
}];
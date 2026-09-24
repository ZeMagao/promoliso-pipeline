return [{
  json: {
    operational_status: 'PUBLISHED',
    published: true,
    topic: $json.topic || '',
    content_key: $json.content_key || '',
    instagram_post_id: $json.instagram_post_id || '',
    instagram_story_id: $json.instagram_story_id || '',
    finished_at: new Date().toISOString(),
  },
}];
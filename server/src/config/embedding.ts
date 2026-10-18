// The embedding model and its vector size. These two must change together: the
// `memories.embedding` column is vector(EMBEDDING_DIMENSIONS), and a model change
// needs a migration plus a re-embed of every stored memory.
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIMENSIONS = 384;

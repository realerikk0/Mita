/**
 * Represents the information about a model.
 * @stored
 */
export type ModelInfo = {
  id: string
  settings?: ModelSettingParams
  parameters?: ModelRuntimeParams
  engine?: string
}

/**
 * The available model settings.
 */
export type ModelSettingParams = {
  ctx_len?: number
  ngl?: number
  embedding?: boolean
  n_parallel?: number
  cpu_threads?: number
  prompt_template?: string
  pre_prompt?: string
  system_prompt?: string
  ai_prompt?: string
  user_prompt?: string
  // path param
  model_path?: string
  // clip model path
  mmproj?: string
  cont_batching?: boolean
  vision_model?: boolean
  text_model?: boolean
  engine?: boolean
  top_p?: number
  top_k?: number
  min_p?: number
  temperature?: number
  repeat_penalty?: number
  repeat_last_n?: number
  presence_penalty?: number
  frequency_penalty?: number
}

/**
 * The available model runtime parameters.
 */
export type ModelRuntimeParams = {
  temperature?: number
  max_temperature?: number
  token_limit?: number
  top_k?: number
  top_p?: number
  stream?: boolean
  max_tokens?: number
  stop?: string[]
  frequency_penalty?: number
  presence_penalty?: number
  engine?: string
}

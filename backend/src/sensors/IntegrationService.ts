/**
 * Base interface for all Data Ingestion Sensors.
 */
export interface IntegrationService {
  /**
   * Identifies the sensor (e.g. 'canvas', 'timeedit')
   */
  readonly name: string;

  /**
   * Executes the sensor to fetch, validate, and store new data.
   */
  sync(): Promise<void>;
  
  /**
   * Health check to ensure the sensor can still access its target.
   */
  checkHealth(): Promise<boolean>;
}

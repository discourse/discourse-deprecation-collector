# frozen_string_literal: true

# name: discourse-deprecation-collector
# about: Collects metrics for JS deprecations
# version: 1.0
# authors: Discourse

enabled_site_setting :deprecation_collector_enabled

module ::DeprecationCollector
  PLUGIN_NAME = "discourse-deprecation-collector"

  def self.add_to_counter(name, value)
    metric = DiscoursePrometheus::InternalMetric::Custom.new
    metric.type = "Counter"
    metric.labels = { db: RailsMultisite::ConnectionManagement.current_db, deprecation_id: name }
    metric.name = "js_deprecation_count"
    metric.description = "js deprecations reported by clients"
    metric.value = value
    $prometheus_client.send_json(metric.to_h)
  end
end

require_relative "lib/deprecation_collector/engine"

on(:web_fork_started) do
  # initialize counters so that `rate()` works correctly in prometheus
  if defined?(::DiscoursePrometheus)
    DeprecationCollector::List.each { |key| DeprecationCollector.add_to_counter(key, 0) }
  else
    STDERR.puts(
      "Discourse Prometheus plugin is not installed. Deprecation collector will not work.",
    )
  end
end

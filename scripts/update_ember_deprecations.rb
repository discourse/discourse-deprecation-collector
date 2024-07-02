# frozen_string_literal: true

require_relative "../lib/deprecation_collector/list"
require "yaml"
require "open-uri"

begin
  deprecations = YAML.load_file(DeprecationCollector::DEPRECATION_IDS_FILE)
  ember_deprecations = deprecations["ember_deprecation_ids"] || []

  system("git", "clone", "-q", "https://github.com/ember-learn/deprecation-app", "--depth", "1")

  deprecation_ids = []

  Dir.glob("deprecation-app/content/ember/{v5}/*.md") do |file|
    deprecation_info = YAML.load_file(file)
    display_id = deprecation_info["displayId"] || File.basename(file, ".md")
    deprecation_ids << display_id if display_id
  end

  return if ember_deprecations.sort == deprecation_ids.sort

  deprecations["ember_deprecation_ids"] = deprecation_ids
  File.write(DeprecationCollector::DEPRECATION_IDS_FILE, deprecations.to_yaml)
  puts "Updated ember deprecations"
ensure
  system("rm", "-rf", "deprecation-app")
end

# frozen_string_literal: true

require "yaml"
require "open-uri"

begin
  system("git", "clone", "-q", "https://github.com/ember-learn/deprecation-app", "--depth", "1")

  deprecation_ids = []

  Dir.glob("deprecation-app/content/ember/{v5}/*.md") do |file|
    frontmatter = YAML.load_file(file)
    display_id = frontmatter["displayId"] || File.basename(file, ".md")
    deprecation_ids << display_id if display_id
  end

  puts deprecation_ids
ensure
  system("rm", "-rf", "deprecation-app")
end

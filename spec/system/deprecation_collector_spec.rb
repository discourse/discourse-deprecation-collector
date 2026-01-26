# frozen_string_literal: true

describe "Deprecation collector" do
  it "successfully reports deprecations to the server" do
    SiteSetting.deprecation_collector_enabled = true

    visit("/latest")
    expect(find("#main-outlet-wrapper")).to be_visible

    logged_deprecations = []

    test_deprecation_id = "fake-ember-deprecation"
    DeprecationCollector::List.push(test_deprecation_id)

    stub =
      DeprecationCollector
        .stubs(:add_to_counter)
        .with do |value|
          logged_deprecations << value
          true
        end

    # Trigger some fake deprecations
    page.execute_script <<~JS
      const deprecated = require("discourse-common/lib/deprecated").default;
      deprecated("Fake deprecation message", { id: #{test_deprecation_id.to_json} })
      deprecated("Second fake deprecation message", { id: "discourse.fake_deprecation" })
    JS

    # Refresh the page to trigger the collector
    page.refresh

    try_until_success do
      expect(logged_deprecations).to include(test_deprecation_id, "_other_discourse")
    end
  ensure
    DeprecationCollector::List.push(test_deprecation_id)
  end
end

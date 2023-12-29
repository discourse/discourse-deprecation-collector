# frozen_string_literal: true

describe "Deprecation collector", type: :system do
  before { SiteSetting.deprecation_collector_enabled = true }

  let(:test_deprecation_id) { DeprecationCollector::List.first }
  let(:logged_deprecations) { [] }
  let!(:stub) do
    DeprecationCollector
      .stubs(:add_to_counter)
      .with do |value|
        logged_deprecations << value
        true
      end
  end

  it "successfully reports deprecations to the server" do
    visit("/latest")
    expect(find("#main-outlet-wrapper")).to be_visible

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
  end

  it "warns admins about deprecations when enabled" do
    sign_in Fabricate(:admin)

    SiteSetting.deprecation_collector_warn_critical_deprecations = true
    SiteSetting.deprecation_collector_critical_deprecations_message =
      "Discourse core changes will be applied to your site on Jan 15."

    visit("/latest")

    page.execute_script <<~JS
      const deprecated = require("discourse-common/lib/deprecated").default;
      deprecated("Fake deprecation message", { id: #{test_deprecation_id.to_json} })
    JS

    message = find("#global-notice-critical-deprecation")
    expect(message).to have_text(
      "One of your themes or plugins needs updating for compatibility with upcoming Discourse core changes",
    )
    expect(message).to have_text(SiteSetting.deprecation_collector_critical_deprecations_message)
  end
end

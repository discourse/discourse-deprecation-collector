import { apiInitializer } from "discourse/lib/api";

export default apiInitializer((api) => {
  api.container.lookup("service:deprecation-collector");
});

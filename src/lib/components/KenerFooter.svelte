<script lang="ts">
  import { page } from "$app/state";

  let { data } = page;
</script>

<div class="container mx-auto flex justify-center px-4">
  {@html data.footerHTML}
</div>

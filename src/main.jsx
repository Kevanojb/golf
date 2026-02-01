<script>
  (function () {
    var base = "/golf/";
    var path = window.location.pathname;

    // If someone hits /golf/<slug>, convert to /golf/#/<slug>
    if (path.startsWith(base) && path !== base && path !== base + "index.html") {
      var slug = path.slice(base.length); // everything after /golf/
      window.location.replace(base + "#/" + slug + window.location.search + window.location.hash);
    }
  })();
</script>


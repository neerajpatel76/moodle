// (C) Copyright 2015 Martin Dougiamas
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

angular.module('mm.addons.mod_resource')

/**
 * Resource factory.
 *
 * @module mm.addons.mod_resource
 * @ngdoc service
 * @name $mmaModResource
 */
.factory('$mmaModResource', function($mmFilepool, $mmSite, $mmUtil, $mmFS, $http, $log, $q, $sce, $mmApp, $mmSitesManager,
            mmaModResourceComponent) {
    $log = $log.getInstance('$mmaModResource');

    var self = {};

    /**
     * Download all the content. All the files are downloaded inside a folder in filepool, keeping their folder structure.
     *
     * @module mm.addons.mod_resource
     * @ngdoc method
     * @name $mmaModResource#downloadAllContent
     * @param {Object} module The module object.
     * @return {Promise}      Promise resolved when content is downloaded. Data returned is not reliable.
     */
    self.downloadAllContent = function(module) {
        var files = self.getDownloadableFiles(module),
            siteid = $mmSite.getId(),
            promise,
            revision = $mmFilepool.getRevisionFromFileList(module.contents),
            timemod = $mmFilepool.getTimemodifiedFromFileList(module.contents);

        if (self.isDisplayedInIframe(module)) {
            // Get path of the module folder in filepool.
            promise = $mmFilepool.getFilePathByUrl(siteid, module.url);
        } else {
            promise = $q.when();
        }

        return promise.then(function(dirPath) {
            return $mmFilepool.downloadPackage(siteid, files, mmaModResourceComponent, module.id, revision, timemod, dirPath);
        });
    };

    /**
     * Returns a list of files that can be downloaded.
     *
     * @module mm.addons.mod_resource
     * @ngdoc method
     * @name $mmaModresource#getDownloadableFiles
     * @param {Object} module The module object returned by WS.
     * @return {Object[]}     List of files.
     */
    self.getDownloadableFiles = function(module) {
        var files = [];

        angular.forEach(module.contents, function(content) {
            if (self.isFileDownloadable(content)) {
                files.push(content);
            }
        });

        return files;
    };

    /**
     * Get event names of files being downloaded.
     *
     * @module mm.addons.mod_resource
     * @ngdoc method
     * @name $mmaModResource#getDownloadingFilesEventNames
     * @param {Object} module The module object returned by WS.
     * @return {Promise} Resolved with an array of event names.
     */
    self.getDownloadingFilesEventNames = function(module) {
        var promises = [],
            eventNames = [],
            siteid = $mmSite.getId();

        angular.forEach(module.contents, function(content) {
            var url = content.fileurl;
            if (!self.isFileDownloadable(content)) {
                return;
            }
            promises.push($mmFilepool.isFileDownloadingByUrl(siteid, url).then(function() {
                return $mmFilepool.getFileEventNameByUrl(siteid, url).then(function(eventName) {
                    eventNames.push(eventName);
                });
            }, function() {
                // Ignore fails.
            }));
        });

        return $q.all(promises).then(function() {
            return eventNames;
        });
    };

    /**
     * Returns a list of file event names.
     *
     * @module mm.addons.mod_resource
     * @ngdoc method
     * @name $mmaModResource#getFileEventNames
     * @param {Object} module The module object returned by WS.
     * @return {Promise} Promise resolved with array of $mmEvent names.
     */
    self.getFileEventNames = function(module) {
        var promises = [];
        angular.forEach(module.contents, function(content) {
            var url = content.fileurl;
            if (!self.isFileDownloadable(content)) {
                return;
            }
            promises.push($mmFilepool.getFileEventNameByUrl($mmSite.getId(), url));
        });
        return $q.all(promises).then(function(eventNames) {
            return eventNames;
        });
    };

    /**
     * Download all the files needed and returns the src of the iframe.
     *
     * @module mm.addons.mod_resource
     * @ngdoc method
     * @name $mmaModResource#getIframeSrc
     * @param {Object} module The module object.
     * @return {Promise}      Promise resolved with the iframe src.
     */
    self.getIframeSrc = function(module) {
        if (!module.contents.length) {
            return $q.reject();
        }

        var mainFile = module.contents[0],
            mainFilePath = mainFile.filename;

        if (mainFile.filepath !== '/') {
            mainFilePath = mainFile.filepath.substr(1) + mainFilePath;
        }

        return $mmFilepool.getDirectoryUrlByUrl($mmSite.getId(), module.url).then(function(dirPath) {
            // This URL is going to be injected in an iframe, we need trustAsResourceUrl to make it work in a browser.
            return $sce.trustAsResourceUrl($mmFS.concatenatePaths(dirPath, mainFilePath));
        }, function() {
            // Error getting directory, there was an error downloading or we're in browser. Return online URL.
            if ($mmApp.isOnline() && mainFile.fileurl) {
                // This URL is going to be injected in an iframe, we need this to make it work.
                return $sce.trustAsResourceUrl($mmSite.fixPluginfileURL(mainFile.fileurl));
            }
            return $q.reject();
        });
    };

    /**
     * Gets the resource HTML.
     *
     * @module mm.addons.mod_resource
     * @ngdoc method
     * @name $mmaModResource#getResourceHtml
     * @param {Object[]} contents Array of content objects.
     * @param {Number} moduleId The module ID.
     * @param {String} [target] The HTML file that the user wants to open, if not defined uses the main file.
     * @return {Promise}
     */
    self.getResourceHtml = function(contents, moduleId, target) {
        var indexUrl,
            paths = {},
            promise;

        // Extract the information about paths from the module contents.
        angular.forEach(contents, function(content, index) {
            var url = content.fileurl,
                fullpath = content.filename;

            if (content.filepath !== '/') {
                fullpath = content.filepath.substr(1) + fullpath;
            }

            if (typeof target !== 'undefined' && target == fullpath) {
                // We use another index.
                indexUrl = url;
            } else if (typeof target === 'undefined' && index === 0) {
                // We use the main page, it should always be the first one.
                indexUrl = url;
            } else {
                // Any other file in the resource.
                paths[fullpath] = url;
            }
        });

        // Promise handling when we are in a browser.
        promise = (function() {
            if (!indexUrl) {
                // If ever that happens.
                $log.debug('Could not locate the index page');
                return $q.reject();
            }
            if ($mmFS.isAvailable()) {
                // The file system is available.
                return $mmFilepool.downloadUrl($mmSite.getId(), indexUrl, false, mmaModResourceComponent, moduleId);
            } else {
                // We return the live URL.
                return $q.when($mmSite.fixPluginfileURL(indexUrl));
            }
        })();

        return promise.then(function(url) {
            // Fetch the URL content.
            return $http.get(url).then(function(response) {
                if (typeof response.data !== 'string') {
                    return $q.reject();
                } else {
                    // Now that we have the content, we update the SRC to point back to
                    // the external resource. That will be caught by mm-format-text.
                    var html = angular.element('<div>');
                        html.append(response.data);

                    angular.forEach(html.find('img'), function(img) {
                        var src = paths[decodeURIComponent(img.getAttribute('src'))];
                        if (typeof src !== 'undefined') {
                            img.setAttribute('src', src);
                        }
                    });
                    // We do the same for links.
                    angular.forEach(html.find('a'), function(anchor) {
                        var href = decodeURIComponent(anchor.getAttribute('href')),
                            url = paths[href],
                            ext = $mmFS.getFileExtension(href);
                        if (typeof url !== 'undefined') {
                            anchor.setAttribute('href', url);
                            if (ext == 'html' || ext == 'html') {
                                anchor.setAttribute('mma-mod-resource-html-link', 1);
                                anchor.setAttribute('data-href', href);
                            }
                        }
                    });

                    return html.html();
                }
            });
        });
    };

    /**
     * Invalidate the prefetched content.
     *
     * @module mm.addons.mod_resource
     * @ngdoc method
     * @name $mmaModResource#invalidateContent
     * @param {Number} moduleId The module ID.
     * @return {Promise}
     */
    self.invalidateContent = function(moduleId) {
        return $mmFilepool.invalidateFilesByComponent($mmSite.getId(), mmaModResourceComponent, moduleId);
    };

    /**
     * Whether the resource has to be displayed in an iframe.
     *
     * @module mm.addons.mod_resource
     * @ngdoc method
     * @name $mmaModResource#isDisplayedInIframe
     * @param {Object} module The module object.
     * @return {Boolean}
     */
    self.isDisplayedInIframe = function(module) {
        var inline = self.isDisplayedInline(module);

        if (inline && $mmFS.isAvailable()) {
            for (var i = 0; i < module.contents.length; i++) {
                var ext = $mmFS.getFileExtension(module.contents[i].filename);
                if (ext == 'js' || ext == 'swf' || ext == 'css') {
                    return true;
                }
            }
        }

        return false;
    };

    /**
     * Whether the resource is to be displayed inline (HTML).
     *
     * @module mm.addons.mod_resource
     * @ngdoc method
     * @name $mmaModResource#isDisplayedInline
     * @param {Object} module The module object.
     * @return {Boolean}
     */
    self.isDisplayedInline = function(module) {
        if (!module.contents.length) {
            return false;
        }
        var ext = $mmFS.getFileExtension(module.contents[0].filename);
        return ext === 'htm' || ext === 'html';
    };

    /**
     * Check if a file is downloadable. The file param must have a 'type' attribute like in core_course_get_contents response.
     *
     * @module mm.addons.mod_resource
     * @ngdoc method
     * @name $mmaModResource#isFileDownloadable
     * @param {Object} file File to check.
     * @return {Boolean}    True if downloadable, false otherwise.
     */
    self.isFileDownloadable = function(file) {
        return file.type === 'file';
    };

    /**
     * Check if resource plugin is enabled in a certain site.
     *
     * @module mm.addons.mod_resource
     * @ngdoc method
     * @name $mmaModResource#isPluginEnabled
     * @param  {String} [siteId] Site ID. If not defined, current site.
     * @return {Promise}         Promise resolved with true if plugin is enabled, rejected or resolved with false otherwise.
     */
    self.isPluginEnabled = function(siteId) {
        siteId = siteId || $mmSite.getId();

        return $mmSitesManager.getSite(siteId).then(function(site) {
            return site.canDownloadFiles();
        });
    };

    /**
     * Report the resource as being viewed.
     *
     * @module mm.addons.mod_resource
     * @ngdoc method
     * @name $mmaModResource#logView
     * @param {String} id Module ID.
     * @return {Promise}  Promise resolved when the WS call is successful.
     */
    self.logView = function(id) {
        if (id) {
            var params = {
                resourceid: id
            };
            return $mmSite.write('mod_resource_view_resource', params);
        }
        return $q.reject();
    };

    /**
     * Download and open the file from the resource.
     *
     * @module mm.addons.mod_resource
     * @ngdoc method
     * @name $mmaModResource#openFile
     * @param {Object[]} contents Array of content objects.
     * @param {Number} moduleId The module ID.
     * @return {Promise}
     */
    self.openFile = function(contents, moduleId) {
        if (!contents || !contents.length) {
            return $q.reject();
        }

        var files = [contents[0]],
            siteId = $mmSite.getId(),
            revision = $mmFilepool.getRevisionFromFileList(files),
            timeMod = $mmFilepool.getTimemodifiedFromFileList(files),
            promise;

        if ($mmFS.isAvailable()) {
            // The file system is available.
            promise = $mmFilepool.downloadPackage(siteId, files, mmaModResourceComponent, moduleId, revision, timeMod).then(function() {
                return $mmFilepool.getUrlByUrl(siteId, contents[0].fileurl, mmaModResourceComponent, moduleId, timeMod);
            });
        } else {
            // We use the live URL.
            promise = $q.when($mmSite.fixPluginfileURL(url));
        }

        return promise.then(function(localUrl) {
            return $mmUtil.openFile(localUrl);
        });
    };

    /**
     * Prefetch the content.
     *
     * @module mm.addons.mod_resource
     * @ngdoc method
     * @name $mmaModResource#prefetchContent
     * @param {Object} module The module object returned by WS.
     * @return {Promise}      Promise resolved when content is downloaded. Data returned is not reliable.
     */
    self.prefetchContent = function(module) {
        var files = self.getDownloadableFiles(module),
            siteid = $mmSite.getId(),
            promise,
            revision = $mmFilepool.getRevisionFromFileList(module.contents),
            timemod = $mmFilepool.getTimemodifiedFromFileList(module.contents);

        if (self.isDisplayedInIframe(module)) {
            // Get path of the module folder in filepool.
            promise = $mmFilepool.getFilePathByUrl(siteid, module.url);
        } else {
            promise = $q.when();
        }

        return promise.then(function(dirPath) {
            return $mmFilepool.prefetchPackage(siteid, files, mmaModResourceComponent, module.id, revision, timemod, dirPath);
        });
    };

    return self;
});

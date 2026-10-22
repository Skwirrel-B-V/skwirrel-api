// Every core API v3 method, grouped by domain. The order of the domains is the
// order of the folders in Postman and Bruno and of the tags in OpenAPI.
//
// A method that core serves but is missing here (a new core method, or an addon
// method on the source install) fails the build, so nothing is published
// without a deliberate choice of domain.
export const DOMAINS = {
	'Products': [
		'getProducts', 'getProductsByFilter', 'checkProductsInSelection', 'saveProduct',
		'saveProductTranslation', 'saveProductSeo', 'saveProductLegislation', 'saveProductChangeRequest',
		'saveProductCustomGroup', 'saveProductAttachment', 'saveProductCategory', 'saveSimpleProductFeature',
		'deleteProduct', 'deleteProductCategory',
	],
	'Trade items': [
		'getTradeItems', 'saveTradeItem', 'saveTradeItemTranslation', 'saveTradeItemPrice', 'saveTradeItemVat',
		'saveTradeItemCustomGroup', 'saveSimpleTradeItemFeature', 'deleteTradeItem',
	],
	'Grouped products': ['getGroupedProducts', 'getProductGroups', 'saveGroup'],
	'Categories': ['getCategories', 'saveCategory', 'deleteCategory'],
	'Brands, manufacturers and suppliers': [
		'getBrands', 'saveBrand', 'deleteBrand', 'getManufacturers', 'saveManufacturer', 'deleteManufacturer',
		'getSuppliers', 'saveSupplier', 'deleteSupplier',
	],
	'Attachments': ['getAttachments', 'saveAttachment', 'saveSimpleAttachmentFeature'],
	'ETIM': [
		'getEtimReleases', 'getEtimClasses', 'getEtimFeatures', 'getEtimValues', 'getDenormalizedEtimData',
		'getMetaClassifications', 'saveEtimClassification', 'saveEtimFeatureValue', 'deleteEtimClassification',
	],
	'Custom classification': [
		'getCustomClasses', 'getCustomFeatures', 'getCustomUnits', 'getCustomValues',
		'getDenormalizedCustomClassData', 'saveCustomClass', 'saveCustomFeature', 'saveCustomUnit', 'saveCustomValue',
	],
	'Price lists': ['getPriceLists'],
	'Webhooks': ['getWebHooks', 'saveWebHook', 'deleteWebHook'],
};

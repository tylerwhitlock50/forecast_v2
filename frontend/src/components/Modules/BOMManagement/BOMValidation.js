import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { validateBoms } from './bomHelpers';

const BOMValidation = ({ boms, bomItems }) => {
  const validationResults = useMemo(() => validateBoms(boms || [], bomItems || []), [boms, bomItems]);
  const safeBoms = boms || [];
  const safeBomItems = bomItems || [];

  const allValidations = [...validationResults.issues, ...validationResults.warnings];
  const errorCount = validationResults.issues.length;
  const warningCount = validationResults.warnings.length;
  const cleanBoms = validationResults.checkedBoms - validationResults.bomsWithProblems;

  const getValidationIcon = (type) => {
    switch (type) {
      case 'error': return '❌';
      case 'warning': return '⚠️';
      default: return 'ℹ️';
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'high': return '#dc3545';
      case 'medium': return '#ffc107';
      case 'low': return '#17a2b8';
      default: return '#6c757d';
    }
  };

  // Share of lines with a description, a quantity and a cost.
  const healthScore = validationResults.totalLines
    ? (validationResults.completeLines / validationResults.totalLines) * 100
    : 0;

  const recommendations = [];
  if (errorCount > 0) {
    recommendations.push({
      key: 'errors', icon: '🚨', tone: 'bg-red-50',
      text: <><strong>Fix the {errorCount === 1 ? 'error' : 'errors'} first:</strong> {errorCount === 1 ? 'it changes' : 'they change'} the material cost of the products that use these BOMs.</>,
    });
  }
  if (warningCount > 0) {
    recommendations.push({
      key: 'warnings', icon: '📋', tone: 'bg-yellow-50',
      text: <><strong>Check the warnings:</strong> they point at lines whose material cost may be wrong.</>,
    });
  }
  if (safeBoms.length === 0) {
    recommendations.push({
      key: 'none', icon: '📋', tone: 'bg-purple-50',
      text: <><strong>No BOMs yet:</strong> import them on the Import data page (step 6) or add one with Add BOM.</>,
    });
  }

  return (
    <div className="space-y-6">
      {/* Validation Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl">📋</div>
              <div>
                <p className="text-2xl font-bold">{safeBoms.length}</p>
                <p className="text-sm text-muted-foreground">Total BOMs</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl text-green-600">✅</div>
              <div>
                <p className="text-2xl font-bold">{cleanBoms}</p>
                <p className="text-sm text-muted-foreground">BOMs without problems</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl text-yellow-600">⚠️</div>
              <div>
                <p className="text-2xl font-bold">{warningCount}</p>
                <p className="text-sm text-muted-foreground">Warning {warningCount === 1 ? 'check' : 'checks'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="text-3xl text-red-600">❌</div>
              <div>
                <p className="text-2xl font-bold">{errorCount}</p>
                <p className="text-sm text-muted-foreground">Error {errorCount === 1 ? 'check' : 'checks'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Critical Issues */}
      {validationResults.issues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <span>❌</span>
              <span>Critical Issues ({validationResults.issues.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {validationResults.issues.map((validation, index) => (
                <div key={index} className="p-4 border border-red-200 rounded-lg bg-red-50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <Badge variant="destructive" className="bg-red-100 text-red-800">
                        {getValidationIcon(validation.type)}
                      </Badge>
                      <span className="font-semibold">{validation.title}</span>
                      <Badge variant="outline" className="text-xs">{validation.category}</Badge>
                    </div>
                    <Badge 
                      variant="outline" 
                      className="text-xs"
                      style={{ backgroundColor: getSeverityColor(validation.severity), color: 'white' }}
                    >
                      {validation.severity}
                    </Badge>
                  </div>
                  <p className="text-sm mb-3">{validation.description}</p>
                  {validation.items && validation.items.length > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer font-medium text-red-700">Show affected items ({validation.items.length})</summary>
                      <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                        {validation.items.slice(0, 20).map((item, idx) => (
                          <div key={idx} className="text-red-600">• {item}</div>
                        ))}
                        {validation.items.length > 20 && (
                          <div className="text-red-500 italic">... and {validation.items.length - 20} more</div>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Warnings */}
      {validationResults.warnings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <span>⚠️</span>
              <span>Warnings ({validationResults.warnings.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {validationResults.warnings.map((validation, index) => (
                <div key={index} className="p-4 border border-yellow-200 rounded-lg bg-yellow-50">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <Badge variant="outline" className="bg-yellow-100 text-yellow-800">
                        {getValidationIcon(validation.type)}
                      </Badge>
                      <span className="font-semibold">{validation.title}</span>
                      <Badge variant="outline" className="text-xs">{validation.category}</Badge>
                    </div>
                    <Badge 
                      variant="outline" 
                      className="text-xs"
                      style={{ backgroundColor: getSeverityColor(validation.severity), color: 'white' }}
                    >
                      {validation.severity}
                    </Badge>
                  </div>
                  <p className="text-sm mb-3">{validation.description}</p>
                  {validation.items && validation.items.length > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer font-medium text-yellow-700">Show affected items ({validation.items.length})</summary>
                      <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                        {validation.items.slice(0, 20).map((item, idx) => (
                          <div key={idx} className="text-yellow-600">• {item}</div>
                        ))}
                        {validation.items.length > 20 && (
                          <div className="text-yellow-500 italic">... and {validation.items.length - 20} more</div>
                        )}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Clear Message */}
      {allValidations.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="space-y-4">
              <div className="text-6xl">🎉</div>
              <h3 className="text-2xl font-bold text-green-600">All Clear!</h3>
              <p className="text-muted-foreground">Every BOM has lines, and every line has a description, a quantity and a cost.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Line completeness */}
      {validationResults.totalLines > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Line completeness</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-8">
              <div className="flex-shrink-0">
                <div className="w-24 h-24 rounded-full bg-gradient-to-r from-green-400 to-blue-500 flex items-center justify-center">
                  <div className="text-center text-white">
                    <div className="text-2xl font-bold">{Math.round(healthScore)}%</div>
                    <div className="text-xs">Complete</div>
                  </div>
                </div>
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm">Lines with a description, quantity and cost:</span>
                  <span className="font-medium">{validationResults.completeLines.toLocaleString('en-US')} of {validationResults.totalLines.toLocaleString('en-US')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Lines with a problem:</span>
                  <span className={`font-medium ${validationResults.problemLines ? 'text-red-600' : ''}`}>{validationResults.problemLines.toLocaleString('en-US')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm">Unique materials:</span>
                  <span className="font-medium">{new Set(safeBomItems.map(item => item.material_description?.toLowerCase())).size.toLocaleString('en-US')}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recommendations (only when there is something to do) */}
      {recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recommendations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recommendations.map((r) => (
                <div key={r.key} className={`flex items-start space-x-3 p-3 rounded-lg ${r.tone}`}>
                  <span className="text-xl">{r.icon}</span>
                  <span className="text-sm">{r.text}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default BOMValidation;